import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
// Deliberate contract test across packages: the API's own parser must accept the env file.
import { loadApiEnv } from "../../../apps/api/src/env.ts";
import { renderEnvFile, type LoginSecrets } from "./env-file.ts";
import { environmentNames, environments } from "./environments.ts";

const login: LoginSecrets = {
  authSecret: "a".repeat(64),
  smtpUser: "noreply@padvinder.net",
  smtpPassword: "smtp-password-value",
};

test("renderEnvFile encodes the password in DATABASE_URL", () => {
  const content = renderEnvFile({
    account: "acme",
    env: "staging",
    databasePassword: "p@ss/w+rd",
    login,
  });
  expect(content).toContain(
    "DATABASE_URL=postgres://acme_staging:p%40ss%2Fw%2Brd@postgresql-acme.alwaysdata.net:5432/acme_staging\n",
  );
  expect(content).not.toContain("p@ss/w+rd");
});

test("renderEnvFile writes one KEY=value per line after a header comment", () => {
  const content = renderEnvFile({
    account: "acme",
    env: "production",
    databasePassword: "secret",
    login,
  });
  const lines = content.trimEnd().split("\n");
  expect(lines[0]).toMatch(/^# .*provisioning/i);
  expect(lines.filter((line) => !line.startsWith("#"))).toEqual([
    "DATABASE_URL=postgres://acme_production:secret@postgresql-acme.alwaysdata.net:5432/acme_production",
    "API_HOST=::",
    "API_PORT=8300",
    "ALLOWED_ORIGINS=https://padvinder.net",
    "LOG_LEVEL=info",
    "PUBLIC_ORIGIN=https://padvinder.net",
    `AUTH_SECRET=${"a".repeat(64)}`,
    "SMTP_HOST=smtp-acme.alwaysdata.net",
    "SMTP_PORT=465",
    "SMTP_USER=noreply@padvinder.net",
    "SMTP_PASSWORD=smtp-password-value",
    "MAIL_FROM=PadVinder <noreply@padvinder.net>",
  ]);
  expect(content.endsWith("\n")).toBe(true);
});

test("renderEnvFile uses the staging port and origin", () => {
  const content = renderEnvFile({ account: "acme", env: "staging", databasePassword: "x", login });
  expect(content).toContain("API_PORT=8301\n");
  expect(content).toContain("ALLOWED_ORIGINS=https://staging.padvinder.net\n");
  expect(content).toContain("PUBLIC_ORIGIN=https://staging.padvinder.net\n");
});

test("renderEnvFile never sets LOGIN_RATE_LIMITS: the API's default (on) must hold on a server", () => {
  const content = renderEnvFile({ account: "acme", env: "staging", databasePassword: "x", login });
  expect(content).not.toContain("LOGIN_RATE_LIMITS");
});

test("every environment's public origin is one of its allowed origins", () => {
  for (const env of environmentNames) {
    expect(environments[env].allowedOrigins).toContain(environments[env].publicOrigin);
  }
});

// What the services do with the file: Node reads it with --env-file, then the API parses it.
function parseWithNode(content: string): Record<string, string> {
  const directory = mkdtempSync(join(tmpdir(), "padvinder-env-file-"));
  try {
    const file = join(directory, ".env");
    writeFileSync(file, content, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [`--env-file=${file}`, "-e", "process.stdout.write(JSON.stringify(process.env))"],
      { env: {}, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, string>;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the API accepts the env file as Node reads it, in every environment", () => {
  for (const env of environmentNames) {
    // Every character the configuration lets through (see config.ts).
    const awkward: LoginSecrets = {
      authSecret: "Ab1!$%&()*+,-./:;<=>?@[]^_{|}~".padEnd(40, "z"),
      smtpUser: "noreply+login@padvinder.net",
      smtpPassword: "p=ss$w0rd!%&()*+,-./:;<=>?@[]^_{|}~",
    };
    const content = renderEnvFile({
      account: "acme",
      env,
      databasePassword: "p@ss/w+rd #1",
      login: awkward,
    });
    const parsed = parseWithNode(content);
    expect(parsed.AUTH_SECRET).toBe(awkward.authSecret);
    expect(parsed.SMTP_USER).toBe(awkward.smtpUser);
    expect(parsed.SMTP_PASSWORD).toBe(awkward.smtpPassword);
    expect(parsed.MAIL_FROM).toBe("PadVinder <noreply@padvinder.net>");

    const apiEnv = loadApiEnv({ ...parsed, GIT_COMMIT: "abc1234" });
    expect(apiEnv.PUBLIC_ORIGIN).toBe(environments[env].publicOrigin);
    expect(apiEnv.LOGIN_RATE_LIMITS).toBe("on");
    expect(apiEnv.SMTP_HOST).toBe("smtp-acme.alwaysdata.net");
    expect(apiEnv.SMTP_PORT).toBe(465);
    expect(new URL(apiEnv.DATABASE_URL).password).toBe(encodeURIComponent("p@ss/w+rd #1"));
  }
});
