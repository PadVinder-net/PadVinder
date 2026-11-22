import { expect, test } from "vitest";
import { renderEnvFile } from "./env-file.ts";

test("renderEnvFile encodes the password in DATABASE_URL", () => {
  const content = renderEnvFile({ account: "acme", env: "staging", databasePassword: "p@ss/w+rd" });
  expect(content).toContain(
    "DATABASE_URL=postgres://acme_staging:p%40ss%2Fw%2Brd@postgresql-acme.alwaysdata.net:5432/acme_staging\n",
  );
  expect(content).not.toContain("p@ss/w+rd");
});

test("renderEnvFile writes one KEY=value per line after a header comment", () => {
  const content = renderEnvFile({ account: "acme", env: "production", databasePassword: "secret" });
  const lines = content.trimEnd().split("\n");
  expect(lines[0]).toMatch(/^# .*provisioning/i);
  expect(lines.filter((line) => !line.startsWith("#"))).toEqual([
    "DATABASE_URL=postgres://acme_production:secret@postgresql-acme.alwaysdata.net:5432/acme_production",
    "API_HOST=::",
    "API_PORT=8300",
    "ALLOWED_ORIGINS=https://padvinder.net",
    "LOG_LEVEL=info",
  ]);
  expect(content.endsWith("\n")).toBe(true);
});

test("renderEnvFile uses the staging port and origin", () => {
  const content = renderEnvFile({ account: "acme", env: "staging", databasePassword: "x" });
  expect(content).toContain("API_PORT=8301\n");
  expect(content).toContain("ALLOWED_ORIGINS=https://staging.padvinder.net\n");
});
