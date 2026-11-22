import { sshHost, sshUserName, type EnvironmentName } from "./environments.ts";
import type { SshIdentity } from "./remote.ts";

export type InfraConfig = {
  environment: EnvironmentName;
  account: string;
  apiKey: string;
  /** Only when requested: provisioning needs it, deploys do not. */
  databasePassword?: string;
  /** Only when requested. */
  ssh?: { host: string; user: string; identity: SshIdentity; knownHostsFile: string };
};

const accountPattern = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Reads the infrastructure settings from environment variables, under the same names as the
 * GitHub secrets and variables. Errors name the variables, never their values.
 */
export function loadInfraConfig(
  source: Record<string, string | undefined>,
  environment: EnvironmentName,
  options: { databasePassword?: boolean; ssh?: boolean } = {},
): InfraConfig {
  const wantPassword = options.databasePassword ?? true;
  const wantSsh = options.ssh ?? true;
  const required = [
    "ALWAYSDATA_ACCOUNT",
    "ALWAYSDATA_API_KEY",
    ...(wantPassword ? ["DATABASE_PASSWORD"] : []),
    ...(wantSsh ? ["SSH_KNOWN_HOSTS_FILE"] : []),
  ];
  const value = (name: string) => source[name] ?? "";
  const missing = required.filter((name) => value(name) === "");
  // The key comes from DEPLOY_SSH_KEY_FILE when it is set (local runs), otherwise from the
  // ssh-agent in SSH_AUTH_SOCK (CI loads the key into a dedicated agent).
  const keyFile = value("DEPLOY_SSH_KEY_FILE");
  const agentSocket = value("SSH_AUTH_SOCK");
  if (wantSsh && keyFile === "" && agentSocket === "") {
    missing.push("SSH_AUTH_SOCK or DEPLOY_SSH_KEY_FILE");
  }
  if (missing.length > 0) {
    throw new Error(`Set these environment variables: ${missing.join(", ")}`);
  }

  const account = value("ALWAYSDATA_ACCOUNT");
  if (!accountPattern.test(account)) {
    throw new Error(
      "ALWAYSDATA_ACCOUNT may hold only lowercase letters, digits, - and _, and must start with a letter or digit",
    );
  }

  const config: InfraConfig = { environment, account, apiKey: value("ALWAYSDATA_API_KEY") };
  if (wantPassword) config.databasePassword = value("DATABASE_PASSWORD");
  if (wantSsh) {
    config.ssh = {
      host: sshHost(account),
      user: sshUserName(account),
      identity: keyFile === "" ? { agent: agentSocket } : { keyFile },
      knownHostsFile: value("SSH_KNOWN_HOSTS_FILE"),
    };
  }
  return config;
}
