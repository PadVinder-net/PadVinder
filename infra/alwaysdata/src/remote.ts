import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { redact } from "./redact.ts";

/**
 * A host reached over SSH. Remote paths are relative to the SSH user's home directory
 * (absolute paths work too).
 */
export interface Remote {
  /**
   * Runs `command` with bash on the remote host. `env` values are sent over stdin and
   * exported before the command runs, so they never appear on a command line; `stdin` is
   * what the command then reads. Rejects when the command exits with a non-zero code, with
   * the command and its redacted stderr, never its stdin.
   */
  exec(
    command: string,
    options?: { stdin?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string }>;
  /**
   * Writes `content` (sent over stdin) to a temporary file next to `path`, sets `mode`, then
   * renames it over `path`, so readers see the old or the new file, never a partial one.
   * Missing directories are created with mode 700.
   */
  writeFile(path: string, content: string, mode: number): Promise<void>;
  /**
   * Makes `remoteDir` an exact copy of the contents of `localDir` with `rsync -a --delete`.
   * With `linkDest` (an existing remote directory), files that are the same there become
   * hard links instead of copies. Remote paths may only hold letters, digits and `._+-/`.
   */
  upload(localDir: string, remoteDir: string, options?: { linkDest?: string }): Promise<void>;
}

export type SshRemoteOptions = {
  host: string;
  port?: number;
  user: string;
  /** Private key file; the only identity offered. */
  keyFile: string;
  /** The only accepted host keys; an unknown or changed host key is refused. */
  knownHostsFile: string;
  /** Extra values to hide in error messages, besides the `env` values of each call. */
  secrets?: readonly string[];
};

/** Quotes a value as one word for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const safeRemotePathPattern = /^[A-Za-z0-9._+/-]+$/;
// The ssh options also go into rsync's -e string, which is split on whitespace.
const safeLocalArgPattern = /^[^\s'"\\]+$/;

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runProcess(file: string, args: string[], stdin: string): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // A command that does not read its stdin may close it early; that is not an error.
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

export function createSshRemote(options: SshRemoteOptions): Remote {
  const port = options.port ?? 22;
  for (const value of [options.host, options.user, options.keyFile, options.knownHostsFile]) {
    if (!safeLocalArgPattern.test(value) || value.startsWith("-")) {
      throw new Error(`SSH option ${JSON.stringify(value)} may not hold spaces or quotes`);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SSH port ${port} is not a valid port`);
  }

  const sshOptions = [
    "-T",
    // Only the options below count, not ~/.ssh/config or /etc/ssh/ssh_config.
    "-F",
    "none",
    "-p",
    String(port),
    "-l",
    options.user,
    "-i",
    options.keyFile,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `UserKnownHostsFile=${options.knownHostsFile}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];

  function fail(description: string, result: ProcessResult, secrets: readonly string[]): never {
    const all = [...(options.secrets ?? []), ...secrets];
    const stderr = result.stderr.trim();
    throw new Error(
      redact(
        `${description} failed with ${result.signal === null ? `exit code ${result.code}` : `signal ${result.signal}`}${stderr === "" ? "" : `: ${stderr}`}`,
        all,
      ),
    );
  }

  const exec: Remote["exec"] = async (command, execOptions = {}) => {
    const env = execOptions.env ?? {};
    const exports = Object.entries(env).map(([name, value]) => {
      if (!envNamePattern.test(name)) {
        throw new Error(`${JSON.stringify(name)} is not a valid environment variable name`);
      }
      return `export ${name}=${shellQuote(value)}\n`;
    });
    // Stdin is the export lines, a NUL byte, then the command's own stdin. bash's `read`
    // takes bytes from a pipe one at a time, so it stops exactly at the NUL and leaves the
    // rest for the command. Environment variables cannot hold NUL bytes.
    const script = [
      `IFS= read -r -d '' __padvinder_env || exit 125`,
      `eval "$__padvinder_env"`,
      `unset __padvinder_env`,
      command,
    ].join("\n");
    const result = await runProcess(
      "ssh",
      [...sshOptions, "--", options.host, `bash -c ${shellQuote(script)}`],
      `${exports.join("")}\0${execOptions.stdin ?? ""}`,
    );
    if (result.code !== 0) fail(`Remote command \`${command}\``, result, Object.values(env));
    return { stdout: result.stdout, stderr: result.stderr };
  };

  const writeFile: Remote["writeFile"] = async (path, content, mode) => {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
      throw new Error(`File mode ${mode} is not between 0 and 0o7777`);
    }
    const temporary = `${path}.tmp.${randomBytes(6).toString("hex")}`;
    await exec(
      [
        "umask 077",
        `mkdir -p -- "$(dirname -- ${shellQuote(path)})"`,
        `if cat > ${shellQuote(temporary)} && chmod ${mode.toString(8)} ${shellQuote(temporary)} && mv -f -- ${shellQuote(temporary)} ${shellQuote(path)}; then :; else rm -f -- ${shellQuote(temporary)}; exit 1; fi`,
      ].join("\n"),
      { stdin: content },
    );
  };

  const upload: Remote["upload"] = async (localDir, remoteDir, uploadOptions = {}) => {
    const { linkDest } = uploadOptions;
    for (const path of linkDest === undefined ? [remoteDir] : [remoteDir, linkDest]) {
      if (!safeRemotePathPattern.test(path) || path.startsWith("-")) {
        throw new Error(
          `Remote path ${JSON.stringify(path)} may only hold letters, digits and ._+-/`,
        );
      }
    }
    // rsync creates only the last directory, and reads a relative --link-dest from the
    // destination directory, so create the parents and make linkDest absolute.
    const { stdout } = await exec(`mkdir -p -- ${shellQuote(remoteDir)} && pwd`);
    const home = stdout.trim();
    const args = ["-a", "--delete"];
    if (linkDest !== undefined) {
      args.push(`--link-dest=${linkDest.startsWith("/") ? linkDest : `${home}/${linkDest}`}`);
    }
    args.push(
      "-e",
      ["ssh", ...sshOptions].join(" "),
      `${resolve(localDir)}/`,
      `${options.host}:${remoteDir}/`,
    );
    const result = await runProcess("rsync", args, "");
    if (result.code !== 0) fail(`rsync ${args.join(" ")}`, result, []);
  };

  return { exec, writeFile, upload };
}
