import { expect, test } from "vitest";
import { loadInfraConfig } from "./config.ts";

const complete = {
  ALWAYSDATA_ACCOUNT: "acme",
  ALWAYSDATA_API_KEY: "api-key-value",
  DATABASE_PASSWORD: "database-password-value",
  DEPLOY_SSH_KEY_FILE: "/tmp/deploy_key",
  SSH_KNOWN_HOSTS_FILE: "/tmp/known_hosts",
};

test("loadInfraConfig reads every variable and derives the SSH host and user", () => {
  expect(loadInfraConfig(complete, "staging")).toEqual({
    environment: "staging",
    account: "acme",
    apiKey: "api-key-value",
    databasePassword: "database-password-value",
    ssh: {
      host: "ssh-acme.alwaysdata.net",
      user: "acme_deploy",
      keyFile: "/tmp/deploy_key",
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
    "DEPLOY_SSH_KEY_FILE",
    "SSH_KNOWN_HOSTS_FILE",
  ]) {
    expect(message).toContain(name);
  }
  expect(message).not.toContain("ALWAYSDATA_API_KEY");
  expect(message).not.toContain("api-key-value");
});

test("loadInfraConfig can skip the database password and the SSH files", () => {
  const config = loadInfraConfig(
    { ALWAYSDATA_ACCOUNT: "acme", ALWAYSDATA_API_KEY: "k" },
    "staging",
    { databasePassword: false, ssh: false },
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
