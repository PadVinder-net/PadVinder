import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { createLogger } from "@padvinder/logging";
import * as Sentry from "@sentry/node";
import { afterEach, expect, test } from "vitest";
import {
  closeMonitoring,
  flushMonitoring,
  onSentrySendFailure,
  runInNewTrace,
  runJobInSpan,
  setMonitoringUser,
  startServerMonitoring,
  tracesSampler,
  withSpan,
} from "./server";
import { createTestTransport, startFakeSentry, startIpv6OnlyFakeSentry } from "./testing";

const settings = {
  dsn: undefined,
  browserDsn: undefined,
  environment: "staging",
  release: "abc",
} as const;
const silent = { write() {} };

afterEach(async () => {
  await closeMonitoring();
});

// First: no test before it has called Sentry.init in this file.
test("startServerMonitoring without a DSN or transport returns false and sends nothing", async () => {
  expect(startServerMonitoring({ service: "api", settings })).toBe(false);
  expect(Sentry.getClient()).toBeUndefined();
  const logger = createLogger({ service: "api", level: "info", destination: silent });
  logger.error({ err: new Error("boom") }, "Unexpected error");
  setMonitoringUser("u-1");
  setMonitoringUser(null);
  await expect(withSpan("off", "test", {}, async () => 42)).resolves.toBe(42);
  await expect(runJobInSpan({ name: "mail", id: "j-1" }, async () => "done")).resolves.toBe("done");
  await expect(runInNewTrace("off", "test", {}, async () => 7)).resolves.toBe(7);
  await expect(flushMonitoring()).resolves.toBeUndefined();
  await expect(closeMonitoring()).resolves.toBeUndefined();
});

test("an error log line becomes one event with service, environment, release; a warn line none", async () => {
  const t = createTestTransport();
  expect(startServerMonitoring({ service: "api", settings, transport: t.transport })).toBe(true);
  const logger = createLogger({ service: "api", level: "info", destination: silent });
  logger.warn("just a warning");
  logger.error({ err: new Error("boom for noor@example.test") }, "Unexpected error");
  await flushMonitoring();
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]).toMatchObject({
    environment: "staging",
    release: "abc",
    tags: { service: "api" },
    server_name: "api",
  });
  expect(JSON.stringify(t.envelopes())).not.toContain("noor@example.test");
});

test("an error line without err becomes a message event; no Sentry logs are sent", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "worker", settings, transport: t.transport });
  const logger = createLogger({ service: "worker", level: "info", destination: silent });
  logger.info("hello");
  logger.error("Mail to a@b.test failed");
  await flushMonitoring();
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]).toMatchObject({ message: "Mail to [email] failed", server_name: "worker" });
  // A Sentry log would be an item of type "log".
  expect(JSON.stringify(t.envelopes())).not.toContain('"type":"log"');
});

test("setMonitoringUser sends only the id", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "api", settings, transport: t.transport });
  await Sentry.withIsolationScope(async () => {
    setMonitoringUser("u-1");
    Sentry.captureException(new Error("with a user"));
  });
  await flushMonitoring();
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]!.user).toEqual({ id: "u-1" });
});

test("a transaction's spans and breadcrumbs reach Sentry scrubbed", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "api", settings, transport: t.transport });
  const logger = createLogger({ service: "api", level: "info", destination: silent });
  await withSpan("outer", "test", { "outer.note": "for a@b.test" }, async () => {
    Sentry.addBreadcrumb({ message: "GET /api/x?email=c@d.test", data: { to: "e@f.test" } });
    await withSpan("select for g@h.test", "db", { "db.statement": "where x = 'i@j.test'" }, () =>
      Promise.resolve(),
    );
    logger.error({ err: new Error("failed for k@l.test") }, "Unexpected error");
  });
  await flushMonitoring();
  const transaction = t.transactions().find((tx) => tx.transaction === "outer");
  expect(transaction?.spans?.some((span) => span.op === "db")).toBe(true);
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]!.breadcrumbs?.length).toBeGreaterThan(0);
  expect(JSON.stringify(t.envelopes())).not.toMatch(/@(b|d|f|h|j|l)\.test/);
});

test("a job runs in its own trace with its name and id; the heartbeat job is not sampled", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "worker", settings, transport: t.transport });
  await withSpan("around", "test", {}, async () => {
    await runJobInSpan({ name: "mail", id: "j-1" }, async () => {
      Sentry.captureMessage("inside the job");
    });
  });
  await runJobInSpan({ name: "heartbeat", id: "j-2" }, async () => {});
  await flushMonitoring();
  const job = t.transactions().find((tx) => tx.transaction === "mail");
  const around = t.transactions().find((tx) => tx.transaction === "around");
  expect(job).toMatchObject({
    contexts: { trace: { op: "queue.process", data: { "job.name": "mail", "job.id": "j-1" } } },
  });
  expect(job!.contexts!.trace!.trace_id).not.toBe(around!.contexts!.trace!.trace_id);
  expect(t.transactions().find((tx) => tx.transaction === "heartbeat")).toBeUndefined();
  expect(t.events()[0]!.tags).toMatchObject({ "job.name": "mail", "job.id": "j-1" });
});

test("runInNewTrace is a transaction in a trace of its own, also inside another span", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "api", settings, transport: t.transport });
  let later: Promise<number> | undefined;
  await withSpan("request", "test", {}, async () => {
    // Started inside the request, finished after it, as a mail sent in the background.
    later = new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
      runInNewTrace("mail.send", "mail", { "mail.kind": "approved" }, async () => 1),
    );
  });
  await expect(later).resolves.toBe(1);
  await flushMonitoring();
  const mail = t.transactions().find((tx) => tx.transaction === "mail.send");
  const request = t.transactions().find((tx) => tx.transaction === "request");
  expect(mail?.contexts?.trace).toMatchObject({ op: "mail", data: { "mail.kind": "approved" } });
  expect(mail!.contexts!.trace!.trace_id).not.toBe(request!.contexts!.trace!.trace_id);
});

test("a request's user agent does not reach Sentry", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "api", settings, transport: t.transport });
  const server = createServer((_request, response) => response.end("{}"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/me",
        headers: { "user-agent": "Mozilla/5.0 UA-MARKER" },
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flushMonitoring();
  expect(t.transactions().some((tx) => tx.transaction === "GET /api/me")).toBe(true);
  expect(JSON.stringify(t.envelopes())).not.toContain("UA-MARKER");
});

test("withSpan passes on a rejection", async () => {
  const t = createTestTransport();
  startServerMonitoring({ service: "api", settings, transport: t.transport });
  await expect(
    withSpan("failing", "test", {}, () => Promise.reject(new Error("no"))),
  ).rejects.toThrow("no");
});

test.each([
  [{ name: "GET /api/health", attributes: {} }, 0],
  [{ name: "GET", attributes: { "url.path": "/api/events" } }, 0],
  [{ name: "GET", attributes: { "http.target": "/api/health?x=1" } }, 0],
  [{ name: "POST", attributes: { "url.path": "/api/sentry-tunnel" } }, 0],
  [{ name: "POST", attributes: { "url.path": "/api/system/test-error" } }, 1],
  [{ name: "GET /app/", attributes: {} }, 0],
  [{ name: "GET /", attributes: { "url.path": "/" } }, 0],
  [{ name: "GET /assets/x.js", attributes: {} }, 0],
  [{ name: "GET /api", attributes: {} }, 0],
  [{ name: "GET /api/me", attributes: { "url.path": "/api/me" } }, 1],
  [{ name: "POST /api/events-not", attributes: {} }, 1],
  [{ name: "GET /api/health/extra", attributes: {} }, 1],
  [{ name: "heartbeat", attributes: { "job.name": "heartbeat" } }, 0],
  [{ name: "mail", attributes: { "job.name": "mail" } }, 1],
  [{ name: "fixture", attributes: {} }, 1],
])("tracesSampler(%j) is %d", (context, expected) => {
  expect(tracesSampler(context)).toBe(expected);
});

test("stack frames are relative to the release directory; filename and abs_path agree", async () => {
  const t = createTestTransport();
  startServerMonitoring({
    service: "api",
    settings,
    transport: t.transport,
    root: "/home/someone/padvinder/production/releases/x",
  });
  const file = "/home/someone/padvinder/production/releases/x/api/dist/run-abc.js";
  Sentry.captureEvent({
    exception: {
      values: [
        {
          type: "Error",
          value: "boom",
          stacktrace: {
            frames: [
              { filename: file, abs_path: file, lineno: 1 },
              { filename: "node:internal/process", lineno: 2 },
            ],
          },
        },
      ],
    },
  });
  await flushMonitoring();
  const frames = t.events()[0]!.exception!.values![0]!.stacktrace!.frames!;
  expect(frames[0]).toMatchObject({
    filename: "app:///api/dist/run-abc.js",
    abs_path: "app:///api/dist/run-abc.js",
  });
  expect(frames[1]!.filename).toBe("node:internal/process");
  expect(JSON.stringify(t.events())).not.toContain("/home/someone");
});

test("onSentrySendFailure hears an event Sentry refused, with its status and the kind of event", async () => {
  const fake = await startFakeSentry();
  try {
    fake.answerWith(403);
    startServerMonitoring({ service: "api", settings: { ...settings, dsn: fake.dsn } });
    const failures: unknown[] = [];
    onSentrySendFailure((failure) => failures.push(failure));
    Sentry.captureException(new Error("refused"));
    await flushMonitoring();
    expect(failures).toEqual([{ status: 403, eventType: "error" }]);
  } finally {
    await closeMonitoring();
    await fake.close();
  }
});

test("onSentrySendFailure hears nothing when Sentry takes the event", async () => {
  const fake = await startFakeSentry();
  try {
    startServerMonitoring({ service: "api", settings: { ...settings, dsn: fake.dsn } });
    const failures: unknown[] = [];
    onSentrySendFailure((failure) => failures.push(failure));
    Sentry.captureException(new Error("taken"));
    await flushMonitoring();
    expect(fake.events()).toHaveLength(1);
    expect(failures).toEqual([]);
  } finally {
    await closeMonitoring();
    await fake.close();
  }
});

test("the SDK sends over IPv4: an event to a Sentry that only listens on IPv6 does not arrive", async (context) => {
  const ipv6 = await startIpv6OnlyFakeSentry();
  if (ipv6 === null) return context.skip("this machine has no IPv6 loopback");
  try {
    startServerMonitoring({ service: "api", settings: { ...settings, dsn: ipv6.dsn } });
    const failures: unknown[] = [];
    onSentrySendFailure((failure) => failures.push(failure));
    Sentry.captureException(new Error("over IPv6 only"));
    await flushMonitoring();
    // Without a family Node would try both addresses of localhost and reach ::1.
    expect(ipv6.requests()).toEqual([]);
    expect(failures).toEqual([{ status: "no answer", eventType: "error" }]);
  } finally {
    await closeMonitoring();
    await ipv6.close();
  }
});

test("the SDK reaches a Sentry on IPv4 by host name", async () => {
  const ipv4 = await startFakeSentry({ dsnHost: "localhost" });
  try {
    startServerMonitoring({ service: "api", settings: { ...settings, dsn: ipv4.dsn } });
    Sentry.captureException(new Error("over IPv4"));
    await flushMonitoring();
    expect(ipv4.events()).toHaveLength(1);
  } finally {
    await closeMonitoring();
    await ipv4.close();
  }
});

test("onSentrySendFailure does nothing while Sentry is off", () => {
  expect(() => onSentrySendFailure(() => {})).not.toThrow();
});
