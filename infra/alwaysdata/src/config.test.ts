import { expect, test } from "vitest";
import { loadInfraConfig, senderDiffersFromMailbox } from "./config.ts";

const complete = {
  ALWAYSDATA_ACCOUNT: "acme",
  ALWAYSDATA_API_KEY: "api-key-value",
  DATABASE_PASSWORD: "database-password-value",
  AUTH_SECRET: "auth-secret-value-auth-secret-value-0000",
  SMTP_USER: "noreply@padvinder.net",
  SMTP_PASSWORD: "smtp-password-value",
  DEPLOY_SSH_AGENT_SOCK: "/tmp/ssh-agent.sock",
  SSH_KNOWN_HOSTS_FILE: "/tmp/known_hosts",
};

test("loadInfraConfig reads every variable and derives the SSH host and user", () => {
  expect(loadInfraConfig(complete, "staging")).toEqual({
    environment: "staging",
    account: "acme",
    apiKey: "api-key-value",
    databasePassword: "database-password-value",
    login: {
      authSecret: "auth-secret-value-auth-secret-value-0000",
      smtpUser: "noreply@padvinder.net",
      smtpPassword: "smtp-password-value",
    },
    ssh: {
      host: "ssh-acme.alwaysdata.net",
      user: "acme",
      identity: { agent: "/tmp/ssh-agent.sock" },
      knownHostsFile: "/tmp/known_hosts",
    },
  });
});

test("loadInfraConfig names every missing variable without values", () => {
  const source = { ALWAYSDATA_API_KEY: "api-key-value", DATABASE_PASSWORD: "" };
  let message = "";
  try {
    loadInfraConfig(source, "production");
  } catch (error) {
    message = (error as Error).message;
  }
  for (const name of [
    "ALWAYSDATA_ACCOUNT",
    "DATABASE_PASSWORD",
    "AUTH_SECRET",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "DEPLOY_SSH_AGENT_SOCK or DEPLOY_SSH_KEY_FILE",
    "SSH_KNOWN_HOSTS_FILE",
  ]) {
    expect(message).toContain(name);
  }
  expect(message).not.toContain("ALWAYSDATA_API_KEY");
  expect(message).not.toContain("api-key-value");
});

test("loadInfraConfig takes the key from DEPLOY_SSH_KEY_FILE over the agent when both are set", () => {
  expect(
    loadInfraConfig({ ...complete, DEPLOY_SSH_KEY_FILE: "/tmp/deploy_key" }, "staging").ssh
      ?.identity,
  ).toEqual({ keyFile: "/tmp/deploy_key" });
  expect(
    loadInfraConfig(
      { ...complete, DEPLOY_SSH_AGENT_SOCK: "", DEPLOY_SSH_KEY_FILE: "/tmp/deploy_key" },
      "staging",
    ).ssh?.identity,
  ).toEqual({ keyFile: "/tmp/deploy_key" });
});

test("loadInfraConfig ignores SSH_AUTH_SOCK, so a personal agent is never used by accident", () => {
  const { DEPLOY_SSH_AGENT_SOCK: _, ...withoutAgent } = complete;
  expect(() =>
    loadInfraConfig({ ...withoutAgent, SSH_AUTH_SOCK: "/tmp/personal-agent.sock" }, "staging"),
  ).toThrow("Set these environment variables: DEPLOY_SSH_AGENT_SOCK or DEPLOY_SSH_KEY_FILE");
});

test("loadInfraConfig needs the known hosts file with an agent too", () => {
  const { SSH_KNOWN_HOSTS_FILE: _, ...withoutKnownHosts } = complete;
  expect(() => loadInfraConfig(withoutKnownHosts, "staging")).toThrow(
    "Set these environment variables: SSH_KNOWN_HOSTS_FILE",
  );
});

test("loadInfraConfig can skip the env file's secrets and the SSH files", () => {
  const config = loadInfraConfig(
    { ALWAYSDATA_ACCOUNT: "acme", ALWAYSDATA_API_KEY: "k" },
    "staging",
    { envFileSecrets: false, ssh: false },
  );
  expect(config).toEqual({ environment: "staging", account: "acme", apiKey: "k" });
});

test("loadInfraConfig rejects an account name that is not a plain lowercase name", () => {
  for (const account of ["Acme", "acme corp", "acme;rm", "-acme"]) {
    let message = "";
    try {
      loadInfraConfig({ ...complete, ALWAYSDATA_ACCOUNT: account }, "staging");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ALWAYSDATA_ACCOUNT/);
    expect(message).not.toContain(account);
  }
});

test("loadInfraConfig names a missing login secret alone, so the message says what to set", () => {
  for (const name of ["AUTH_SECRET", "SMTP_USER", "SMTP_PASSWORD"]) {
    expect(() => loadInfraConfig({ ...complete, [name]: undefined }, "staging")).toThrow(
      `Set these environment variables: ${name}`,
    );
  }
});

test("loadInfraConfig refuses an AUTH_SECRET shorter than the API accepts, without its value", () => {
  const short = "0123456789abcdef0123456789abcde";
  let message = "";
  try {
    loadInfraConfig({ ...complete, AUTH_SECRET: short }, "staging");
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(/AUTH_SECRET.*at least 32 characters/);
  expect(message).toContain("openssl rand -hex 32");
  expect(message).not.toContain(short);
});

test("loadInfraConfig refuses secrets the env file cannot carry, naming the variable only", () => {
  // Node's --env-file ends a value at #, strips quotes and trims spaces.
  const unsafe = [
    "has space",
    "has#hash",
    'has"quote',
    "has'quote",
    "has`tick",
    "has\\slash",
    "a\nb",
    "tést",
  ];
  for (const name of ["AUTH_SECRET", "SMTP_USER", "SMTP_PASSWORD"]) {
    for (const bad of unsafe) {
      const value = bad.padEnd(40, "x");
      let message = "";
      try {
        loadInfraConfig({ ...complete, [name]: value }, "staging");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(new RegExp(`^${name} `));
      expect(message).not.toContain(value);
    }
  }
});

test("loadInfraConfig refuses an SMTP_USER other than the sender's mailbox, without values", () => {
  const other = "someone-else@padvinder.net";
  let message = "";
  try {
    loadInfraConfig({ ...complete, SMTP_USER: other }, "staging");
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(/^SMTP_USER must be the mailbox address in mailFrom/);
  expect(message).not.toContain(other);
  expect(message).not.toContain("noreply@padvinder.net");
  // The same address in other letter case is the same mailbox.
  expect(() =>
    loadInfraConfig({ ...complete, SMTP_USER: "NoReply@PadVinder.net" }, "staging"),
  ).not.toThrow();
});

test("senderDiffersFromMailbox checks only Alwaysdata's SMTP server", () => {
  expect(senderDiffersFromMailbox("smtp-acme.alwaysdata.net", "other@padvinder.net")).toBe(true);
  expect(senderDiffersFromMailbox("smtp-acme.alwaysdata.net", "noreply@padvinder.net")).toBe(false);
  // Another mail service's login need not be an address.
  expect(senderDiffersFromMailbox("smtp.mail-service.example", "api-login-id")).toBe(false);
});
