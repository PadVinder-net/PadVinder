import { describe, expect, test } from "vitest";
import { createSshRemote, shellQuote } from "./remote.ts";

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
    keyFile: "/nonexistent/id_ed25519",
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
        keyFile: "/a dir/id_ed25519",
        knownHostsFile: "/nonexistent/known_hosts",
      }),
    ).toThrow(/spaces or quotes/);
  });
});
