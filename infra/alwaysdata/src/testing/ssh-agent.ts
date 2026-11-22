import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type SshAgent = {
  /** The agent's socket, for `SshIdentity` `{ agent }`. */
  socket: string;
  pid: number;
  /** Loads a private key over stdin, as the GitHub action does: no key file is read. */
  add(privateKey: string): Promise<void>;
  /** Stops the agent and waits until it is gone; safe to call twice. */
  stop(): Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts a dedicated ssh-agent with its socket in `dir` (keep the path short: a socket path
 * may hold about 100 bytes). It holds no keys until `add`. Call `stop` when done, also on
 * failure, or the agent keeps running.
 */
export async function startSshAgent(dir: string): Promise<SshAgent> {
  const socket = join(dir, "agent.sock");
  const { stdout } = await run("ssh-agent", ["-s", "-a", socket]);
  const pid = Number(/^SSH_AGENT_PID=(\d+);/m.exec(stdout)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("ssh-agent printed no SSH_AGENT_PID");

  const stop = async () => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return; // Already gone.
    }
    for (let i = 0; i < 50 && isRunning(pid); i++) await sleep(100);
    if (isRunning(pid)) process.kill(pid, "SIGKILL");
  };

  const add = (privateKey: string) =>
    new Promise<void>((resolve, reject) => {
      // A lifetime, so a key in an agent that a crashed test left behind does not stay.
      const child = spawn("ssh-add", ["-q", "-t", "600", "-"], {
        env: { ...process.env, SSH_AUTH_SOCK: socket },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ssh-add failed: ${stderr.trim()}`)),
      );
      child.stdin.end(privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`);
    });

  return { socket, pid, add, stop };
}
