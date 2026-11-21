import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSshRemote, type Remote, type SshRemoteOptions } from "../remote.ts";

const run = promisify(execFile);

const image = "padvinder-fake-host:test";
/** Every fake host container carries this label: `docker ps --filter label=padvinder-fake-host`. */
export const fakeHostLabel = "padvinder-fake-host";
const contextDir = join(import.meta.dirname, "../../test/fake-host");

export type FakeHost = {
  /** The fake host over SSH, as the deploy reaches Alwaysdata. */
  remote: Remote;
  /** The SSH options behind `remote`, to make a variant (such as other known hosts). */
  connection: SshRemoteOptions;
  /** Home directory of the SSH user; relative remote paths start here. */
  homeDir: string;
  /** `databaseUrlFromHost` with the host rewritten so the container reaches it. */
  databaseUrl: string;
  /** Runs a bash command in the container as the SSH user, in its home; returns stdout. */
  exec(command: string): Promise<string>;
  /** Removes the container and the key files. */
  stop(): Promise<void>;
};

// Built once per test process; Docker's layer cache makes later builds quick.
let imageBuilt: Promise<unknown> | undefined;
function buildImage(): Promise<unknown> {
  imageBuilt ??= run("docker", ["build", "--quiet", "--tag", image, contextDir], {
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error: unknown) => {
    imageBuilt = undefined;
    throw error;
  });
  return imageBuilt;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The URL as seen from inside the container: the host's localhost is host.docker.internal. */
function rewriteDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    parsed.hostname = "host.docker.internal";
  }
  return parsed.toString();
}

/**
 * Starts a Docker container that stands in for the Alwaysdata SSH host: OpenSSH on a random
 * port on 127.0.0.1, user `padvinder`, Node.js 24, rsync and psql. It logs in with a fresh
 * ed25519 key pair and trusts only the host key scanned from this container.
 */
export async function startFakeHost(options: { databaseUrlFromHost: string }): Promise<FakeHost> {
  const databaseUrl = rewriteDatabaseUrl(options.databaseUrlFromHost);
  const keyDir = await mkdtemp(join(tmpdir(), "padvinder-fake-host-"));
  let containerId: string | undefined;

  const stop = async () => {
    try {
      if (containerId !== undefined) {
        await run("docker", ["rm", "--force", "--volumes", containerId]);
        containerId = undefined;
      }
    } finally {
      await rm(keyDir, { recursive: true, force: true });
    }
  };

  try {
    const keyFile = join(keyDir, "id_ed25519");
    await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", fakeHostLabel, "-f", keyFile]);
    const publicKey = (await readFile(`${keyFile}.pub`, "utf8")).trim();

    await buildImage();
    const { stdout: id } = await run("docker", [
      "run",
      "--detach",
      "--label",
      fakeHostLabel,
      "--publish",
      "127.0.0.1::22",
      "--add-host=host.docker.internal:host-gateway",
      "--env",
      `AUTHORIZED_KEY=${publicKey}`,
      image,
    ]);
    containerId = id.trim();

    const { stdout: address } = await run("docker", ["port", containerId, "22/tcp"]);
    const port = Number(/:(\d+)\s*$/m.exec(address)?.[1]);
    if (!Number.isInteger(port)) throw new Error(`No published SSH port in ${address}`);

    // The published port accepts connections before sshd runs: scan until it answers.
    let scanned = "";
    for (let i = 0; i < 60 && scanned === ""; i++) {
      if (i > 0) await sleep(500);
      const result = await run("ssh-keyscan", [
        "-T",
        "2",
        "-t",
        "ed25519",
        "-p",
        String(port),
        "127.0.0.1",
      ]).catch(() => ({ stdout: "" }));
      scanned = result.stdout
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("#"))
        .join("\n");
    }
    if (scanned === "") throw new Error(`sshd did not answer on 127.0.0.1:${port}`);

    // Trust the scanned key only if it is the key inside this container.
    const { stdout: hostKey } = await run("docker", [
      "exec",
      containerId,
      "cat",
      "/etc/ssh/ssh_host_ed25519_key.pub",
    ]);
    const [keyType, keyData] = hostKey.trim().split(/\s+/);
    if (scanned !== `[127.0.0.1]:${port} ${keyType} ${keyData}`) {
      throw new Error(`The scanned host key does not match the container's: ${scanned}`);
    }
    const knownHostsFile = join(keyDir, "known_hosts");
    await writeFile(knownHostsFile, `${scanned}\n`);

    const container = containerId;
    const connection: SshRemoteOptions = {
      host: "127.0.0.1",
      port,
      user: "padvinder",
      keyFile,
      knownHostsFile,
    };
    return {
      remote: createSshRemote(connection),
      connection,
      homeDir: "/home/padvinder",
      databaseUrl,
      exec: async (command) => {
        const { stdout } = await run(
          "docker",
          ["exec", "-u", "padvinder", "-w", "/home/padvinder", container, "bash", "-c", command],
          { maxBuffer: 16 * 1024 * 1024 },
        );
        return stdout;
      },
      stop,
    };
  } catch (error) {
    const logs =
      containerId === undefined
        ? ""
        : await run("docker", ["logs", containerId]).then(
            ({ stdout, stderr }) => `\nContainer logs:\n${stdout}${stderr}`,
            () => "",
          );
    await stop().catch(() => {});
    throw new Error(`Could not start the fake host: ${String(error)}${logs}`, { cause: error });
  }
}
