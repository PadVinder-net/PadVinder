import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import type { InfraConfig } from "../config.ts";
import { renderEnvFile } from "../env-file.ts";
import type { Remote } from "../remote.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "../testing/fake-api.ts";
import {
  parseProvisionArgs,
  passwordMismatchMessage,
  runProvision,
  type ProvisionArgs,
} from "./provision.ts";

const password = "p@ss/w+rd";
const apiKey = "api/key+value";
const login = {
  authSecret: "auth-secret-value-auth-secret-value-0000",
  smtpUser: "mailbox-user@example.test",
  smtpPassword: "smtp-password-value",
};
const monitoring = {
  sentryDsn: "https://dsnkey0123456789@o123456.ingest.de.sentry.io/7654321",
  sentryBrowserDsn: "https://browserkey012345@o123456.ingest.de.sentry.io/1234567",
};
const config: InfraConfig = {
  environment: "staging",
  account: "acmecorp",
  apiKey,
  databasePassword: password,
  login,
  monitoring,
  ssh: {
    host: "ssh-acmecorp.alwaysdata.net",
    user: "acmecorp",
    identity: { agent: "/nonexistent/agent.sock" },
    knownHostsFile: "/nonexistent/known_hosts",
  },
};
const args = (overrides: Partial<ProvisionArgs> = {}): ProvisionArgs => ({
  environment: "staging",
  apply: false,
  rotatePassword: false,
  inspect: false,
  ...overrides,
});

let fake: FakeAlwaysdata;
let api: AlwaysdataApi;
let calls: { method: string; args: unknown[] }[];
let output: string[];
// Remembers written files, and answers the DATABASE_URL and checksum commands for them.
let remoteFiles: Map<string, string>;
const databaseUrlCommand =
  "if [ -f padvinder/staging/.env ]; then grep -m 1 '^DATABASE_URL=' padvinder/staging/.env || true; fi";
const checksumCommand =
  "if [ -f padvinder/staging/.env ]; then sha256sum < padvinder/staging/.env; fi";
const fakeRemote: Remote = {
  exec: async (...callArgs) => {
    calls.push({ method: "exec", args: callArgs });
    const checksumFile = /sha256sum < (\S+); fi$/.exec(callArgs[0])?.[1];
    if (checksumFile !== undefined) {
      const content = remoteFiles.get(checksumFile);
      const stdout =
        content === undefined ? "" : `${createHash("sha256").update(content).digest("hex")}  -\n`;
      return { stdout, stderr: "" };
    }
    const currentPath = /\[ -e (\S+) \]; then echo yes; fi$/.exec(callArgs[0])?.[1];
    if (currentPath !== undefined) {
      return { stdout: remoteFiles.has(currentPath) ? "yes\n" : "", stderr: "" };
    }
    const grepFile = /'\^DATABASE_URL=' (\S+) \|\| true; fi$/.exec(callArgs[0])?.[1];
    if (grepFile !== undefined) {
      const line = /^DATABASE_URL=.*$/m.exec(remoteFiles.get(grepFile) ?? "")?.[0];
      return { stdout: line === undefined ? "" : `${line}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  },
  writeFile: async (...callArgs) => {
    calls.push({ method: "writeFile", args: callArgs });
    remoteFiles.set(callArgs[0], callArgs[1]);
  },
  upload: async (...callArgs) => void calls.push({ method: "upload", args: callArgs }),
};
/** The account's main SSH user, which Alwaysdata creates with the account. */
const mainSshUserId = 500;
const noReleaseNotice = /No release is live yet, so there is nothing to restart.*first deploy/;
const restartNotice =
  /services must be restarted.*pnpm infra:services --environment staging --restart/;

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey,
    account: config.account,
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  for (const items of fake.resources.values()) items.length = 0;
  fake.resources.get("ssh")!.push({ id: mainSshUserId, name: config.account, shell: "BASH" });
  calls = [];
  output = [];
  remoteFiles = new Map();
});

const run = (provisionArgs: ProvisionArgs) =>
  runProvision({
    args: provisionArgs,
    config,
    api,
    remote: () => fakeRemote,
    print: (line) => output.push(line),
  });
const writes = () => fake.requests.filter((r) => r.method !== "GET");

const expectNoSecrets = (text: string) => {
  for (const value of [
    password,
    encodeURIComponent(password),
    apiKey,
    config.account,
    login.authSecret,
    login.smtpUser,
    login.smtpPassword,
    monitoring.sentryDsn,
    monitoring.sentryBrowserDsn,
    "dsnkey0123456789",
    "browserkey012345",
  ]) {
    expect(text).not.toContain(value);
  }
};

test("without --apply it prints the plan and changes nothing", async () => {
  expect(await run(args())).toBe(0);
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
  expect(output.join("\n")).toMatch(/create\s+service\s+padvinder-api \(staging\)/);
  // A site is labeled by its address: the API does not keep a site's name.
  expect(output.join("\n")).toMatch(/create\s+site\s+staging\.padvinder\.net\/ /);
});

test("plan output never contains the password", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  fake.resources.get("database")![0]!.locale = `x${password}`;
  expect(await run(args({ rotatePassword: true }))).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/create\s+database\/user\s+<account>_staging/);
  expect(text).toMatch(/conflict\s+database/);
  expectNoSecrets(text);
});

test("with --apply it creates the resources, then writes the env file and the releases directory", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  expect(writes().filter((r) => r.method === "POST")).toHaveLength(5);
  const servicePosts = writes().filter((r) => r.path === "/v1/service/");
  expect(servicePosts.map((r) => (r.body as { ssh_user?: unknown }).ssh_user)).toEqual([
    mainSshUserId,
    mainSshUserId,
  ]);
  expect(calls).toEqual([
    { method: "exec", args: [databaseUrlCommand] },
    { method: "exec", args: [checksumCommand] },
    {
      method: "writeFile",
      args: [
        "padvinder/staging/.env",
        renderEnvFile({
          account: config.account,
          env: "staging",
          databasePassword: password,
          login,
          monitoring,
        }),
        0o600,
      ],
    },
    { method: "exec", args: ["mkdir -p -- padvinder/staging/releases"] },
    { method: "exec", args: ["if [ -e padvinder/staging/current ]; then echo yes; fi"] },
  ]);
  expect(output.join("\n")).toMatch(noReleaseNotice);
  expect(output.join("\n")).not.toMatch(/must be restarted/);
  expectNoSecrets(output.join("\n"));
});

test("a restart is asked for only when the env file changed or the password was rotated", async () => {
  remoteFiles.set("padvinder/staging/current", "release");
  await run(args({ apply: true }));
  output = [];
  expect(await run(args({ apply: true }))).toBe(0);
  expect(output.join("\n")).not.toMatch(/restart/);

  output = [];
  expect(await run(args({ apply: true, rotatePassword: true }))).toBe(0);
  expect(output.join("\n")).toMatch(restartNotice);

  // Another line changed, the password did not.
  const envFile = renderEnvFile({
    account: config.account,
    env: "staging",
    databasePassword: password,
    login,
    monitoring,
  });
  remoteFiles.set("padvinder/staging/.env", envFile.replace("LOG_LEVEL=info", "LOG_LEVEL=debug"));
  output = [];
  expect(await run(args({ apply: true }))).toBe(0);
  expect(output.join("\n")).toMatch(restartNotice);
  expect(remoteFiles.get("padvinder/staging/.env")).toBe(envFile);
});

test("with a live release, a changed env file asks for a restart; if the check fails, it does too", async () => {
  remoteFiles.set("padvinder/staging/current", "release");
  expect(await run(args({ apply: true }))).toBe(0);
  expect(output.join("\n")).toMatch(restartNotice);

  remoteFiles.set("padvinder/staging/.env", "LOG_LEVEL=debug\n");
  const failingCheck: Remote = {
    ...fakeRemote,
    exec: (...callArgs) =>
      callArgs[0].includes("-e padvinder")
        ? Promise.reject(new Error("connection lost"))
        : fakeRemote.exec(...callArgs),
  };
  remoteFiles.delete("padvinder/staging/current");
  output = [];
  const code = await runProvision({
    args: args({ apply: true, rotatePassword: true }),
    config,
    api,
    remote: () => failingCheck,
    print: (line) => output.push(line),
  });
  expect(code).toBe(0);
  expect(output.join("\n")).toMatch(restartNotice);
});

test("--apply refuses a password that differs from the env file's, unless --rotate-password", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  const oldPassword = "old-secret-value";
  const oldEnvFile = renderEnvFile({
    account: config.account,
    env: "staging",
    databasePassword: oldPassword,
    login,
    monitoring,
  });
  remoteFiles.set("padvinder/staging/.env", oldEnvFile);
  calls = [];
  output = [];
  fake.requests.length = 0;

  expect(await run(args({ apply: true }))).toBe(1);
  const text = output.join("\n");
  expect(text).toContain(passwordMismatchMessage);
  expect(text).not.toContain(oldPassword);
  expect(text).not.toMatch(/postgres:\/\//);
  expectNoSecrets(text);
  expect(calls.filter((call) => call.method !== "exec")).toEqual([]);
  expect(calls.map((call) => call.args[0])).not.toContain("mkdir -p -- padvinder/staging/releases");
  expect(writes()).toEqual([]);
  expect(remoteFiles.get("padvinder/staging/.env")).toBe(oldEnvFile);

  output = [];
  remoteFiles.set("padvinder/staging/current", "release");
  expect(await run(args({ apply: true, rotatePassword: true }))).toBe(0);
  expect(writes().some((r) => r.method === "PATCH")).toBe(true);
  expect(remoteFiles.get("padvinder/staging/.env")).toBe(
    renderEnvFile({
      account: config.account,
      env: "staging",
      databasePassword: password,
      login,
      monitoring,
    }),
  );
  expect(output.join("\n")).toMatch(restartNotice);
  expect(output.join("\n")).not.toContain(oldPassword);
});

test("a password mismatch stops before any change through the API", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  remoteFiles.set(
    "padvinder/staging/.env",
    renderEnvFile({
      account: config.account,
      env: "staging",
      databasePassword: "old-secret",
      login,
      monitoring,
    }),
  );
  // Something else to apply, too.
  fake.resources.get("service")![0]!.command = "node old.js";
  fake.requests.length = 0;
  calls = [];
  output = [];

  expect(await run(args({ apply: true }))).toBe(1);
  expect(output.join("\n")).toContain(passwordMismatchMessage);
  expect(output.join("\n")).not.toMatch(/Applied the plan/);
  expect(writes()).toEqual([]);
  expect(calls.map((call) => call.args[0])).toEqual([databaseUrlCommand, checksumCommand]);
});

test("an SSH failure stops before any change through the API, also on the first run", async () => {
  const unreachable: Remote = {
    ...fakeRemote,
    exec: async () => {
      throw new Error(`Permission denied for ${config.account}`);
    },
  };
  const runUnreachable = (provisionArgs: ProvisionArgs) =>
    runProvision({
      args: provisionArgs,
      config,
      api,
      remote: () => unreachable,
      print: (line) => output.push(line),
    });

  // The first run: nothing exists yet, and nothing is created.
  expect(await runUnreachable(args({ apply: true }))).toBe(1);
  expect(writes()).toEqual([]);
  const text = output.join("\n");
  expect(text).toMatch(/Could not read padvinder\/staging\/\.env over SSH/);
  expect(text).toMatch(/Nothing was changed through the API/);
  expect(text).toMatch(
    /the deploy public key is on the main SSH user <account> in the Alwaysdata panel/,
  );
  expect(text).toMatch(/Permission denied for <account>/);
  expectNoSecrets(text);

  // Later: the password is not rotated either.
  expect(await run(args({ apply: true }))).toBe(0);
  fake.requests.length = 0;
  output = [];
  expect(await runUnreachable(args({ apply: true, rotatePassword: true }))).toBe(1);
  expect(writes()).toEqual([]);
  expect(output.join("\n")).toMatch(/Nothing was changed through the API/);
});

test("the first run, without an env file, reads it before the apply and writes it after", async () => {
  // How many resources were created when each SSH command ran.
  const createdAtExec: number[] = [];
  const counting: Remote = {
    ...fakeRemote,
    exec: (...callArgs) => {
      createdAtExec.push(writes().filter((r) => r.method === "POST").length);
      return fakeRemote.exec(...callArgs);
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api,
    remote: () => counting,
    print: (line) => output.push(line),
  });
  expect(code).toBe(0);
  // Both reads before the first create, the releases directory after the last.
  expect(createdAtExec).toEqual([0, 0, 5, 5]);
  expect(calls.slice(0, 2)).toEqual([
    { method: "exec", args: [databaseUrlCommand] },
    { method: "exec", args: [checksumCommand] },
  ]);
  expect(calls[2]?.method).toBe("writeFile");
  expect(output.join("\n")).toMatch(/Applied the plan\.\nWrote padvinder\/staging\/\.env/);
  expect(output.join("\n")).toMatch(noReleaseNotice);
});

for (const [situation, sshUsers] of [
  ["no SSH user named like the account", [{ id: 501, name: "acmecorp_deploy" }]],
  [
    "two SSH users named like the account",
    [
      { id: 501, name: "acmecorp" },
      { id: 502, name: "acmecorp" },
    ],
  ],
] as const) {
  test(`${situation} fails before any write, also with --apply`, async () => {
    fake.resources.set(
      "ssh",
      sshUsers.map((user) => ({ ...user })),
    );
    for (const provisionArgs of [args(), args({ apply: true })]) {
      output = [];
      expect(await run(provisionArgs)).toBe(1);
      const text = output.join("\n");
      expect(text).toMatch(
        sshUsers.length === 1
          ? /Provisioning failed: No SSH user named <account> on the account; the services must run as the account's main SSH user\./
          : /Provisioning failed: 2 SSH users are named <account>; expected one/,
      );
      expect(text).not.toMatch(/Plan for/);
      expectNoSecrets(text);
    }
    expect(writes()).toEqual([]);
    expect(calls).toEqual([]);
  });
}

test("a create-only field the API leaves out of the new resource gives a warning", async () => {
  // Stands in for an API that ignores an unknown field on create.
  const dropping: AlwaysdataApi = {
    ...api,
    create: (kind, body, identity) => {
      const { extensions: _dropped, ...rest } = body;
      return api.create(kind, rest, identity);
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api: dropping,
    remote: () => fakeRemote,
    print: (line) => output.push(line),
  });
  expect(code).toBe(0);
  expect(output.join("\n")).toMatch(
    /Warning: Could not verify extensions of new database <account>_staging/,
  );
  output = [];
  expect(await run(args())).toBe(0);
  expect(output.join("\n")).toMatch(/ok\s+database\s+<account>_staging; cannot verify extensions/);
});

test("a second --apply writes nothing to the API and rewrites the same env file", async () => {
  await run(args({ apply: true }));
  const count = writes().length;
  const first = calls;
  calls = [];
  expect(await run(args({ apply: true }))).toBe(0);
  expect(writes().length).toBe(count);
  // The first run also checked for a release, to decide what to tell about restarting.
  expect(calls).toEqual(first.slice(0, -1));
});

test("a conflict exits 1 and changes nothing", async () => {
  await run(args({ apply: true }));
  fake.resources.get("database")![0]!.locale = "en_US.UTF-8";
  fake.requests.length = 0;
  calls = [];
  output = [];
  expect(await run(args({ apply: true }))).toBe(1);
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
  expect(output.join("\n")).toMatch(/locale/);
});

test("an SSH failure while writing after the apply exits 1 and says to run again", async () => {
  const failing: Remote = {
    ...fakeRemote,
    writeFile: async () => {
      throw new Error(`Permission denied for ${config.account}`);
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api,
    remote: () => failing,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/Applied the plan/);
  expect(text).toMatch(
    /Could not write padvinder\/staging\/\.env over SSH after applying the plan\..*run again with --apply/,
  );
  expect(text).toMatch(/Permission denied for <account>/);
  expectNoSecrets(text);
});

test("the Sentry DSN in an error shows as ***", async () => {
  const failing: Remote = {
    ...fakeRemote,
    writeFile: async (_path, content) => {
      throw new Error(`could not write ${content}`);
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api,
    remote: () => failing,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/SENTRY_DSN=\*\*\*/);
  expect(text).toMatch(/SENTRY_BROWSER_DSN=\*\*\*/);
  expectNoSecrets(text);
});

test("an IP address in an SSH error shows as <ip>", async () => {
  const failing: Remote = {
    ...fakeRemote,
    exec: async () => {
      throw new Error("ssh: connect to host 2001:db8::1 port 22: Connection refused");
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api,
    remote: () => failing,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  expect(output.join("\n")).toContain("connect to host <ip> port 22");
});

test("an API error exits 1 with a redacted message", async () => {
  fake.failNext(400);
  expect(await run(args({ apply: true }))).toBe(1);
  expect(output.join("\n")).toMatch(/failed with 400/);
  expectNoSecrets(output.join("\n"));
});

test("--inspect shows only field types of other resources, and the managed values of ours", async () => {
  await run(args({ apply: true }));
  fake.requests.length = 0;
  output = [];
  fake.resources.get("service")!.push({
    id: 90,
    annotation: "other app",
    command: "node other.js --token=abc",
    environment: "SECRET_X=abc OTHER=1",
    ssh_user: 1,
  });
  fake.resources.get("site")!.push({
    id: 91,
    name: "other",
    type: "php",
    addresses: ["other.example"],
    ip: "2001:db8::1",
  });
  fake.resources.get("ssh")!.push({ id: 92, name: "other_ssh", password: "ssh-secret-pw" });
  fake.resources.get("ssh")![0]!.password = "main-secret-pw";
  const ourUser = fake.resources.get("database/user")![0]!;
  ourUser.nested = { api_key: "zzz", ok: true };

  expect(await run(args({ inspect: true }))).toBe(0);
  expect(writes()).toEqual([]);
  const text = output.join("\n");
  for (const value of [
    "SECRET_X",
    "abc",
    "other.example",
    "2001:db8",
    "other.js",
    "zzz",
    "other_ssh",
    "secret-pw",
  ]) {
    expect(text).not.toContain(value);
  }
  expectNoSecrets(text);

  const inspected = JSON.parse(text) as Record<
    string,
    { fields: Record<string, string>; ours: Record<string, unknown>[] }
  >;
  expect(Object.keys(inspected)).toEqual(["ssh", "database", "database/user", "site", "service"]);
  // Of the SSH users only the main user's id and name; the others' only as shapes.
  expect(inspected.ssh?.ours).toEqual([{ id: mainSshUserId, name: "<account>" }]);
  expect(inspected.ssh?.fields).toEqual({
    id: "number",
    name: "string",
    shell: "string",
    password: "string",
  });
  expect(inspected.site?.fields).toMatchObject({
    addresses: "string[]",
    ssl_force: "boolean",
    ip: "string",
  });
  expect(inspected.service?.fields).toMatchObject({ ssh_user: "number", environment: "string" });
  expect(inspected["database/user"]?.fields).toMatchObject({
    password: "string",
    permissions: "object{<account>_staging: string}",
    nested: "object{api_key: string, ok: boolean}",
  });
  expect(inspected.service?.ours).toEqual([
    expect.objectContaining({
      annotation: "padvinder-api (staging)",
      command: "node --env-file=release.env --env-file=../../.env api/dist/main.js",
      environment: "NODEJS_VERSION=<value>",
      ssh_user: mainSshUserId,
    }),
    expect.objectContaining({ annotation: "padvinder-worker (staging)" }),
  ]);
  expect(inspected.site?.ours).toEqual([
    {
      id: expect.any(Number),
      type: "reverse_proxy",
      addresses: ["staging.padvinder.net/"],
      ssl_force: true,
      url: "http://services-<account>.alwaysdata.net:8301",
    },
  ]);
  expect(inspected["database/user"]?.ours).toEqual([
    {
      id: ourUser.id,
      name: "<account>_staging",
      type: "POSTGRESQL",
      permissions: { "<account>_staging": "FULL" },
    },
  ]);
});

test("parseProvisionArgs reads the flags and rejects anything else", () => {
  expect(parseProvisionArgs(["--environment", "production", "--apply"])).toEqual(
    args({ environment: "production", apply: true }),
  );
  expect(parseProvisionArgs(["--environment=staging", "--apply", "--rotate-password"])).toEqual(
    args({ apply: true, rotatePassword: true }),
  );
  for (const bad of [
    [],
    ["--environment", "test"],
    ["--environment", "staging", "--force"],
    ["--environment", "staging", "extra"],
    ["--environment", "staging", "--inspect", "--apply"],
    ["--environment", "staging", "--rotate-password"],
  ]) {
    expect(() => parseProvisionArgs(bad)).toThrow(/Usage/);
  }
});

test("the CLI exits 2 with usage on an unknown flag and 1 on missing variables", () => {
  const script = fileURLToPath(new URL("./provision.ts", import.meta.url));
  const env = { PATH: process.env.PATH ?? "" };
  const unknown = spawnSync(process.execPath, [script, "--bogus"], { env, encoding: "utf8" });
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toMatch(/Usage/);
  const rotateOnly = spawnSync(
    process.execPath,
    [script, "--environment", "staging", "--rotate-password"],
    { env, encoding: "utf8" },
  );
  expect(rotateOnly.status).toBe(2);
  expect(rotateOnly.stderr).toMatch(/--rotate-password changes the password: pass --apply too/);
  const missing = spawnSync(process.execPath, [script, "--environment", "staging"], {
    env,
    encoding: "utf8",
  });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/ALWAYSDATA_API_KEY/);
  expect(missing.stderr).toMatch(
    /AUTH_SECRET, SMTP_USER, SMTP_PASSWORD, SENTRY_DSN, SENTRY_BROWSER_DSN/,
  );
  // Inspect writes no env file, so it does without them.
  const inspect = spawnSync(process.execPath, [script, "--environment", "staging", "--inspect"], {
    env: { ...env, ALWAYSDATA_ACCOUNT: "acme" },
    encoding: "utf8",
  });
  expect(inspect.status).toBe(1);
  expect(inspect.stderr).toBe("Set these environment variables: ALWAYSDATA_API_KEY\n");
});

test("without the login secrets it fails before reading or changing anything", async () => {
  const { login: _, ...withoutLogin } = config;
  const code = await runProvision({
    args: args({ apply: true }),
    config: withoutLogin,
    api,
    remote: () => fakeRemote,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  expect(output.join("\n")).toMatch(
    /Provisioning failed: AUTH_SECRET, SMTP_USER and SMTP_PASSWORD are not set/,
  );
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
});

test("without the Sentry DSN it fails before reading or changing anything", async () => {
  const { monitoring: _, ...withoutMonitoring } = config;
  const code = await runProvision({
    args: args({ apply: true }),
    config: withoutMonitoring,
    api,
    remote: () => fakeRemote,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  expect(output.join("\n")).toMatch(
    /Provisioning failed: SENTRY_DSN and SENTRY_BROWSER_DSN are not set/,
  );
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
});

test("a new login secret rewrites the env file and asks for a restart, without rotate-password", async () => {
  remoteFiles.set("padvinder/staging/current", "release");
  const oldEnvFile = renderEnvFile({
    account: config.account,
    env: "staging",
    databasePassword: password,
    login: { ...login, authSecret: "old-auth-secret-old-auth-secret-000000" },
    monitoring,
  });
  remoteFiles.set("padvinder/staging/.env", oldEnvFile);
  expect(await run(args({ apply: true }))).toBe(0);
  const written = remoteFiles.get("padvinder/staging/.env");
  expect(written).toContain(`AUTH_SECRET=${login.authSecret}\n`);
  expect(written).toContain(`SMTP_PASSWORD=${login.smtpPassword}\n`);
  expect(written).toContain(`SENTRY_DSN=${monitoring.sentryDsn}\n`);
  expect(written).toContain(`SENTRY_BROWSER_DSN=${monitoring.sentryBrowserDsn}\n`);
  expect(written).toContain("PADVINDER_ENVIRONMENT=staging\n");
  expect(calls.find((call) => call.method === "writeFile")?.args[2]).toBe(0o600);
  const text = output.join("\n");
  expect(text).toMatch(restartNotice);
  expect(text).not.toContain("old-auth-secret");
  expectNoSecrets(text);
});

test("an env file from before login gets the login lines, with the same database password", async () => {
  remoteFiles.set("padvinder/staging/current", "release");
  const full = renderEnvFile({
    account: config.account,
    env: "staging",
    databasePassword: password,
    login,
    monitoring,
  });
  const beforeLogin = full
    .split("\n")
    .filter((line) => !/^(PUBLIC_ORIGIN|AUTH_SECRET|SMTP_\w+|MAIL_FROM)=/.test(line))
    .join("\n");
  remoteFiles.set("padvinder/staging/.env", beforeLogin);
  expect(await run(args({ apply: true }))).toBe(0);
  expect(remoteFiles.get("padvinder/staging/.env")).toBe(full);
  expect(output.join("\n")).toMatch(restartNotice);
});
