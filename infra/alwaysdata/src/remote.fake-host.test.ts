import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSshRemote } from "./remote.ts";
import { startFakeHost, type FakeHost } from "./testing/fake-host.ts";

const run = promisify(execFile);

let host: FakeHost;
let localDir: string;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set; run ./scripts/setup-workspace.sh");
  host = await startFakeHost({ databaseUrlFromHost: databaseUrl });
  localDir = await mkdtemp(join(tmpdir(), "padvinder-remote-test-"));
}, 180_000);

afterAll(async () => {
  await host?.stop();
  if (localDir) await rm(localDir, { recursive: true, force: true });
});

describe("exec", () => {
  test("runs a command in the home directory and returns stdout", async () => {
    expect(await host.remote.exec("echo hi")).toEqual({ stdout: "hi\n", stderr: "" });
    expect((await host.remote.exec("pwd")).stdout).toBe(`${host.homeDir}\n`);
  });

  test("passes stdin to the command", async () => {
    const { stdout } = await host.remote.exec("cat", { stdin: "line one\nline 'two'\n" });
    expect(stdout).toBe("line one\nline 'two'\n");
  });

  test("env values reach the command but not its argv", async () => {
    const secret = "env-value-that-must-not-be-in-argv";
    const pending = host.remote.exec(`sleep 2; printf '%s' "$SECRET"`, {
      env: { SECRET: secret },
    });
    // Wait until the remote sleep runs, then look at every process on both sides.
    let remoteArgs = "";
    for (let i = 0; i < 50 && !remoteArgs.includes("sleep 2"); i++) {
      remoteArgs = await host.exec("ps -eo args");
    }
    const { stdout: localArgs } = await run("ps", ["-A", "-o", "args"], {
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(remoteArgs).toContain("sleep 2");
    expect(remoteArgs).not.toContain(secret);
    expect(localArgs).not.toContain(secret);
    expect((await pending).stdout).toBe(secret);
  });

  test("env and stdin work together, with quotes and newlines in values", async () => {
    const value = 'it\'s a "value"\nwith $dollar and `backticks`';
    const { stdout } = await host.remote.exec(`printf '%s|' "$A"; cat`, {
      env: { A: value },
      stdin: "from stdin",
    });
    expect(stdout).toBe(`${value}|from stdin`);
  });

  test("a failing command throws with the command and redacted stderr, without stdin", async () => {
    const secret = "secret-in-stderr";
    const error = await host.remote
      .exec(`cat > /dev/null; echo "bad $TOKEN" >&2; exit 3`, {
        env: { TOKEN: secret },
        stdin: "stdin-that-stays-private",
      })
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain(`echo "bad $TOKEN"`);
    expect(error?.message).toContain("exit code 3");
    expect(error?.message).toContain("bad ***");
    expect(error?.message).not.toContain(secret);
    expect(error?.message).not.toContain("stdin-that-stays-private");
  });
});

describe("writeFile", () => {
  test("writes atomically with the given mode, creating directories", async () => {
    const content = "KEY='value with spaces'\nOTHER=\"x\"\n";
    await host.remote.writeFile("config dir/secrets.env", content, 0o600);
    expect(await host.exec("stat -c %a 'config dir/secrets.env'")).toBe("600\n");
    expect(await host.exec("stat -c %a 'config dir'")).toBe("700\n");
    expect(await host.exec("cat 'config dir/secrets.env'")).toBe(content);

    await host.remote.writeFile("config dir/secrets.env", "replaced\n", 0o640);
    expect(await host.exec("stat -c %a 'config dir/secrets.env'")).toBe("640\n");
    expect(await host.exec("cat 'config dir/secrets.env'")).toBe("replaced\n");
    // No temporary files stay behind.
    expect(await host.exec("ls -A 'config dir'")).toBe("secrets.env\n");
  });
});

describe("upload", () => {
  test("upload with linkDest hard-links unchanged files and deletes extra ones", async () => {
    await mkdir(join(localDir, "node_modules/pkg"), { recursive: true });
    await writeFile(join(localDir, "node_modules/pkg/index.js"), "unchanged\n");
    await writeFile(join(localDir, "main.js"), "version 1\n");
    await host.remote.upload(localDir, "releases/one");

    await writeFile(join(localDir, "main.js"), "version 2, longer\n");
    await host.exec("mkdir -p releases/two && echo stale > releases/two/stale.txt");
    await host.remote.upload(localDir, "releases/two", { linkDest: "releases/one" });

    const inode = (path: string) => host.exec(`stat -c %i ${path}`);
    expect(await inode("releases/two/node_modules/pkg/index.js")).toBe(
      await inode("releases/one/node_modules/pkg/index.js"),
    );
    expect(await inode("releases/two/main.js")).not.toBe(await inode("releases/one/main.js"));
    expect(await host.exec("cat releases/one/main.js releases/two/main.js")).toBe(
      "version 1\nversion 2, longer\n",
    );
    expect(await host.exec("ls -A releases/two")).toBe("main.js\nnode_modules\n");
  });
});

test("an unknown host key is refused", async () => {
  const emptyKnownHosts = join(localDir, "empty_known_hosts");
  await writeFile(emptyKnownHosts, "");
  const stranger = createSshRemote({ ...host.connection, knownHostsFile: emptyKnownHosts });
  await expect(stranger.exec("echo hi")).rejects.toThrow(/Host key verification failed/);
});
