export const environmentNames = ["staging", "production"] as const;
export type EnvironmentName = (typeof environmentNames)[number];

export type Environment = {
  /** Public addresses of the site; Let's Encrypt certificates follow automatically. */
  addresses: string[];
  /** Port of the API service; Alwaysdata services must use 8300–8499. */
  apiPort: number;
  /** Exact origins for `ALLOWED_ORIGINS`. */
  allowedOrigins: string[];
  /** The origin users open, for `PUBLIC_ORIGIN`; must be one of `allowedOrigins`. */
  publicOrigin: string;
};

export const environments: Record<EnvironmentName, Environment> = {
  production: {
    addresses: ["padvinder.net"],
    apiPort: 8300,
    allowedOrigins: ["https://padvinder.net"],
    publicOrigin: "https://padvinder.net",
  },
  staging: {
    addresses: ["staging.padvinder.net"],
    apiPort: 8301,
    allowedOrigins: ["https://staging.padvinder.net"],
    publicOrigin: "https://staging.padvinder.net",
  },
};

export function isEnvironmentName(value: string): value is EnvironmentName {
  return (environmentNames as readonly string[]).includes(value);
}

/** Directory of an environment, relative to the account home `/home/<account>`. */
export const environmentDirectory = (env: EnvironmentName) => `padvinder/${env}`;

export const databaseName = (account: string, env: EnvironmentName) => `${account}_${env}`;
export const databaseHost = (account: string) => `postgresql-${account}.alwaysdata.net`;
/** PostgreSQL directly; pgBouncer on 5433 breaks LISTEN/NOTIFY. */
export const databasePort = 5432;
export const sshHost = (account: string) => `ssh-${account}.alwaysdata.net`;
/**
 * The SSH login for provisioning and deploys: the account's main SSH user, which Alwaysdata
 * creates with the account and names after it. Provisioning creates no SSH user of its own:
 * SSH users are not chrooted (each reaches the whole account), and several of them cause
 * file-rights problems, so releases and env files belong to the main user like everything else.
 */
export const sshUser = (account: string) => account;

/**
 * Mail goes out through Alwaysdata's own SMTP server, logged in as a mailbox on the account
 * (SMTP_USER and SMTP_PASSWORD). Port 465 with implicit TLS, as Alwaysdata documents it; the
 * API requires TLS whenever it logs in. Another provider (Lettermint, Brevo) means changing
 * these two and the SMTP secrets: the API only assumes SMTP.
 */
export const smtpHost = (account: string) => `smtp-${account}.alwaysdata.net`;
export const smtpPort = 465;
/** The sender of every mail, in both environments: the mailbox SMTP_USER logs in as. */
export const mailFrom = "PadVinder <noreply@padvinder.net>";
