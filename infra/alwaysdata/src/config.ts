import type { LoginSecrets } from "./env-file.ts";
import {
  mailFromAddress,
  smtpHost,
  sshHost,
  sshUser,
  type EnvironmentName,
} from "./environments.ts";
import type { SshIdentity } from "./remote.ts";

export type InfraConfig = {
  environment: EnvironmentName;
  account: string;
  apiKey: string;
  /** Only when requested: provisioning writes it to the env file, deploys do not need it. */
  databasePassword?: string;
  /** Only when requested, like the database password. */
  login?: LoginSecrets;
  /** Only when requested. */
  ssh?: { host: string; user: string; identity: SshIdentity; knownHostsFile: string };
};

const accountPattern = /^[a-z0-9][a-z0-9_-]*$/;

/** The env file's secrets, in the order errors name them. */
const loginSecretNames = ["AUTH_SECRET", "SMTP_USER", "SMTP_PASSWORD"] as const;
/** The API refuses a shorter AUTH_SECRET (apps/api/src/env.ts). */
const authSecretMinLength = 32;
/**
 * What Node's --env-file reads back unchanged from an unquoted value: printable ASCII
 * without spaces, quotes, backslashes and `#` (a comment). Tested in env-file.test.ts.
 */
const envFileValuePattern = /^[\x21-\x7e]+$/;
const envFileUnsafePattern = /["#'\\`]/;

/**
 * Whether SMTP_USER cannot send as `mailFrom`: Alwaysdata's SMTP server sends only as the
 * mailbox it logs in as. Another mail service may use a login that is not an address.
 */
export function senderDiffersFromMailbox(host: string, smtpUser: string): boolean {
  return (
    host.endsWith(".alwaysdata.net") && smtpUser.toLowerCase() !== mailFromAddress.toLowerCase()
  );
}

/**
 * Reads the infrastructure settings from environment variables, under the same names as the
 * GitHub secrets and variables. Errors name the variables, never their values.
 */
export function loadInfraConfig(
  source: Record<string, string | undefined>,
  environment: EnvironmentName,
  options: { envFileSecrets?: boolean; ssh?: boolean } = {},
): InfraConfig {
  // The database password and the login secrets go into the env file together: provisioning
  // never writes a file without them, because the API refuses to start on it.
  const wantSecrets = options.envFileSecrets ?? true;
  const wantSsh = options.ssh ?? true;
  const required = [
    "ALWAYSDATA_ACCOUNT",
    "ALWAYSDATA_API_KEY",
    ...(wantSecrets ? ["DATABASE_PASSWORD", ...loginSecretNames] : []),
    ...(wantSsh ? ["SSH_KNOWN_HOSTS_FILE"] : []),
  ];
  const value = (name: string) => source[name] ?? "";
  const missing = required.filter((name) => value(name) === "");
  // The key comes from DEPLOY_SSH_KEY_FILE when it is set (local runs), otherwise from the
  // ssh-agent in DEPLOY_SSH_AGENT_SOCK (CI loads the key into a dedicated agent). Never from
  // SSH_AUTH_SOCK: that is usually a personal agent, and a run must not use it by accident.
  const keyFile = value("DEPLOY_SSH_KEY_FILE");
  const agentSocket = value("DEPLOY_SSH_AGENT_SOCK");
  if (wantSsh && keyFile === "" && agentSocket === "") {
    missing.push("DEPLOY_SSH_AGENT_SOCK or DEPLOY_SSH_KEY_FILE");
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
  if (wantSecrets) {
    for (const name of loginSecretNames) {
      const secret = value(name);
      if (!envFileValuePattern.test(secret) || envFileUnsafePattern.test(secret)) {
        throw new Error(
          `${name} may hold only printable ASCII characters, without spaces, quotes, backslashes or #: the env file on the server cannot carry them`,
        );
      }
    }
    if (value("AUTH_SECRET").length < authSecretMinLength) {
      throw new Error(
        `AUTH_SECRET must have at least ${authSecretMinLength} characters, or the API does not start; make one with openssl rand -hex 32`,
      );
    }
    if (senderDiffersFromMailbox(smtpHost(account), value("SMTP_USER"))) {
      throw new Error(
        "SMTP_USER must be the mailbox address in mailFrom (src/environments.ts): Alwaysdata's SMTP server sends only as the mailbox it logs in as",
      );
    }
    config.databasePassword = value("DATABASE_PASSWORD");
    config.login = {
      authSecret: value("AUTH_SECRET"),
      smtpUser: value("SMTP_USER"),
      smtpPassword: value("SMTP_PASSWORD"),
    };
  }
  if (wantSsh) {
    config.ssh = {
      host: sshHost(account),
      user: sshUser(account),
      identity: keyFile === "" ? { agent: agentSocket } : { keyFile },
      knownHostsFile: value("SSH_KNOWN_HOSTS_FILE"),
    };
  }
  return config;
}
