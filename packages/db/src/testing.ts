import { randomInt } from "node:crypto";
import { connect, createServer, type Socket } from "node:net";
import pg from "pg";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";

export type TestDatabase = {
  url: string;
  db: Db;
  pool: pg.Pool;
  /** Closes the pool and drops the clone. Safe to call more than once. */
  drop(): Promise<void>;
};

const SUFFIX_LENGTH = 8;
// PostgreSQL truncates identifiers longer than 63 bytes.
const MAX_NAME_BYTES = 63;
// SQLSTATE object_in_use: the template still had a connection that was closing.
const OBJECT_IN_USE = "55006";

function templateUrl(): URL {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Run scripts/setup-workspace.sh.");
  return new URL(url);
}

function templateName(): string {
  return decodeURIComponent(templateUrl().pathname.slice(1));
}

function urlForDatabase(name: string): string {
  const url = templateUrl();
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Runs work on a short-lived connection to the `postgres` database and always closes it. */
async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: urlForDatabase("postgres"),
    connectionTimeoutMillis: 2_000,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function randomSuffix(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += String.fromCharCode(97 + randomInt(26));
  return suffix;
}

/**
 * Drops and recreates the template database, migrates it and closes every connection to it.
 * Also drops clones left behind by an interrupted run: they are disposable.
 * Call this once per test run, before any test file starts.
 */
export async function prepareTestTemplate(): Promise<void> {
  const template = templateName();
  const stale = new RegExp(
    `^${template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_[a-z]{${SUFFIX_LENGTH}}$`,
  );
  await withAdmin(async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like $1",
      [`${template.replace(/[\\%_]/g, "\\$&")}\\_%`],
    );
    for (const { datname } of rows.filter((row) => stale.test(row.datname))) {
      await admin.query(`drop database if exists ${quoteIdentifier(datname)} with (force)`);
    }
    await admin.query(`drop database if exists ${quoteIdentifier(template)} with (force)`);
    await admin.query(`create database ${quoteIdentifier(template)}`);
  });
  await runMigrations(urlForDatabase(template));
}

/** Creates an isolated, migrated database as a clone of the template. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const template = templateName();
  const name = `${template}_${randomSuffix()}`;
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    throw new Error(
      `Test database name "${name}" is longer than ${MAX_NAME_BYTES} bytes. Use a shorter workspace name.`,
    );
  }
  await withAdmin(async (admin) => {
    const sql = `create database ${quoteIdentifier(name)} template ${quoteIdentifier(template)}`;
    // The template's last connection may still be closing on the server; retry briefly.
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.query(sql);
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== OBJECT_IN_USE || attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  const url = urlForDatabase(name);
  const { db, pool } = createDb(url);
  let dropping: Promise<void> | undefined;
  return {
    url,
    db,
    pool,
    // Idempotent; drops the clone even when closing the pool fails.
    drop() {
      dropping ??= (async () => {
        try {
          await pool.end();
        } finally {
          await withAdmin((admin) =>
            admin.query(`drop database if exists ${quoteIdentifier(name)} with (force)`),
          );
        }
      })();
      return dropping;
    },
  };
}

export type StallingProxy = {
  /** The database URL with host and port pointing at the proxy. */
  url: string;
  /** From now on, swallow all traffic in both directions without closing any connection. */
  stall(): void;
  /** Forward traffic again. What was swallowed while stalled stays lost. */
  resume(): void;
  close(): Promise<void>;
};

/**
 * A TCP proxy in front of a database that forwards until `stall()`, then behaves like a hung
 * server or a half-open connection: connections stay open, but no byte arrives anymore, until
 * `resume()`.
 */
export async function startStallingProxy(databaseUrl: string): Promise<StallingProxy> {
  const target = new URL(databaseUrl);
  const sockets = new Set<Socket>();
  let stalled = false;
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
      socket.on("error", () => socket.destroy());
    }
    client.on("data", (chunk) => stalled || upstream.write(chunk));
    upstream.on("data", (chunk) => stalled || client.write(chunk));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(databaseUrl);
  url.hostname = "127.0.0.1";
  url.port = String((server.address() as { port: number }).port);
  return {
    url: url.toString(),
    stall() {
      stalled = true;
    },
    resume() {
      stalled = false;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
