import { describe, expect, test } from "vitest";
import { createSshRemote, shellQuote, sshOptions, type SshRemoteOptions } from "./remote.ts";

describe("shellQuote", () => {
  test("wraps a value in single quotes and escapes single quotes", () => {
    expect(shellQuote("a b'c")).toBe(`'a b'\\''c'`);
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("$HOME `x` \\n")).toBe("'$HOME `x` \\n'");
  });
});

describe("createSshRemote", () => {
  // These fail before ssh or rsync starts, so they need no host.
  const remote = createSshRemote({
    host: "fake-host.invalid",
    user: "padvinder",
    identity: { agent: "/nonexistent/agent.sock" },
    knownHostsFile: "/nonexistent/known_hosts",
  });

  test("rejects an environment variable name that is not a plain identifier", async () => {
    await expect(remote.exec("true", { env: { "A B": "x" } })).rejects.toThrow(
      /environment variable name/,
    );
    await expect(remote.exec("true", { env: { "A;rm": "x" } })).rejects.toThrow(
      /environment variable name/,
    );
  });

  test("rejects an environment variable value with a NUL byte", async () => {
    await expect(remote.exec("true", { env: { A: "x\0y" } })).rejects.toThrow(/NUL byte/);
  });

  test("rejects a mode outside 0 to 0o7777", async () => {
    await expect(remote.writeFile("a", "b", 0o10000)).rejects.toThrow(/mode/);
    await expect(remote.writeFile("a", "b", 1.5)).rejects.toThrow(/mode/);
  });

  test("rejects remote upload paths with characters rsync might reinterpret", async () => {
    await expect(remote.upload("/tmp", "releases/a b")).rejects.toThrow(/Remote path/);
    await expect(remote.upload("/tmp", "releases/a", { linkDest: "x;y" })).rejects.toThrow(
      /Remote path/,
    );
  });

  test("refuses SSH options that rsync's -e string would split", () => {
    expect(() =>
      createSshRemote({
        host: "fake-host.invalid",
        user: "padvinder",
        identity: { keyFile: "/a dir/id_ed25519" },
        knownHostsFile: "/nonexistent/known_hosts",
      }),
    ).toThrow(/spaces or quotes/);
  });
});

describe("sshOptions", () => {
  const base = {
    host: "fake-host.invalid",
    port: 2222,
    user: "padvinder",
    knownHostsFile: "/tmp/known_hosts",
  };
  const pairs = (args: string[]) => args.map((arg, i) => `${args[i - 1] ?? ""} ${arg}`);

  test("with an agent, offers only the agent's keys: no key file, no other agent", () => {
    const args = sshOptions({ ...base, identity: { agent: "/tmp/agent.sock" } });
    expect(args).toEqual(expect.arrayContaining(["-F", "none", "-p", "2222", "-l", "padvinder"]));
    expect(pairs(args)).toEqual(
      expect.arrayContaining([
        "-o IdentityAgent=/tmp/agent.sock",
        // IdentitiesOnly=yes would make ssh offer no agent key without an IdentityFile.
        "-o IdentityFile=none",
        "-o IdentitiesOnly=no",
        "-o UserKnownHostsFile=/tmp/known_hosts",
        "-o GlobalKnownHostsFile=/dev/null",
        "-o StrictHostKeyChecking=yes",
        "-o BatchMode=yes",
      ]),
    );
    expect(args).not.toContain("-i");
    expect(args).not.toContain("IdentitiesOnly=yes");
  });

  test("with a key file, offers only that file", () => {
    const args = sshOptions({ ...base, identity: { keyFile: "/tmp/id_ed25519" } });
    expect(pairs(args)).toEqual(
      expect.arrayContaining(["-i /tmp/id_ed25519", "-o IdentitiesOnly=yes"]),
    );
    expect(args.some((arg) => arg.startsWith("IdentityAgent="))).toBe(false);
    expect(args).not.toContain("IdentityFile=none");
  });

  test("refuses an agent socket that is not a plain absolute path", () => {
    for (const agent of ["/a dir/agent.sock", "/tmp/a'b", "-oProxyCommand=x"]) {
      expect(() => sshOptions({ ...base, identity: { agent } })).toThrow(/spaces or quotes/);
    }
    // IdentityAgent reads these words as "no agent" and "the agent in SSH_AUTH_SOCK".
    for (const agent of ["none", "SSH_AUTH_SOCK", "agent.sock"]) {
      expect(() => sshOptions({ ...base, identity: { agent } })).toThrow(/absolute path/);
    }
  });

  test("refuses a port outside 1 to 65535", () => {
    const options: SshRemoteOptions = { ...base, port: 0, identity: { agent: "/tmp/a.sock" } };
    expect(() => sshOptions(options)).toThrow(/not a valid port/);
  });
});
