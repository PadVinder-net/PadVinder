import {
  createTransport,
  parseEnvelope,
  type BaseTransportOptions,
  type Envelope,
  type Event,
} from "@sentry/core";
import * as Sentry from "@sentry/react";
import { afterEach, expect, test } from "vitest";
import {
  captureCrash,
  lastErrorEventId,
  sentErrorEventId,
  setBrowserMonitoringUser,
  startBrowserMonitoring,
  stopBrowserMonitoring,
} from "./browser-monitoring";

function testTransport() {
  const envelopes: Envelope[] = [];
  const transport = (options: BaseTransportOptions) =>
    createTransport(options, async (request) => {
      envelopes.push(parseEnvelope(request.body));
      return { statusCode: 200 };
    });
  const itemsOfType = (type: string) =>
    envelopes.flatMap(([, items]) =>
      items.filter(([header]) => header.type === type).map(([, payload]) => payload as Event),
    );
  return {
    transport,
    envelopes: () => envelopes,
    events: () => itemsOfType("event"),
  };
}

function start(t: ReturnType<typeof testTransport>, app: "app" | "portal" = "app") {
  return startBrowserMonitoring({
    app,
    appVersion: "2027.1.0",
    release: "abc123",
    enabled: true,
    transport: t.transport,
  });
}

afterEach(async () => {
  await stopBrowserMonitoring();
  document.body.innerHTML = "";
});

// First: nothing before it has started Sentry in this file.
test("does nothing outside a production build", () => {
  expect(startBrowserMonitoring({ app: "app", appVersion: "2027.1.0", release: "abc" })).toBe(
    false,
  );
  expect(Sentry.getClient()).toBeUndefined();
  setBrowserMonitoringUser("u1");
  expect(lastErrorEventId()).toBeUndefined();
  // A crash under the dev server has no event to link a report to.
  expect(captureCrash(new Error("crash"))).toBeUndefined();
  expect(sentErrorEventId(Sentry.captureException(new Error("crash")))).toBeUndefined();
});

test("sends through the tunnel with the placeholder DSN, no replay and no feedback", () => {
  const t = testTransport();
  expect(start(t)).toBe(true);
  const options = Sentry.getClient()!.getOptions();
  expect(options.tunnel).toBe("/api/sentry-tunnel");
  expect(options.dsn).toBe("https://public@padvinder.invalid/1");
  expect(options.tracePropagationTargets).toEqual([/^\/api\//]);
  // Release health: sessions are sent only with a release.
  expect(options.release).toBe("abc123");
  expect(options.dataCollection).toEqual({
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
  });
  const names = options.integrations.map((integration) => integration.name);
  expect(names).toContain("BrowserTracing");
  expect(names).toContain("BrowserSession");
  expect(names.filter((name) => /replay|feedback/i.test(name))).toEqual([]);
});

test("an error arrives with the app's tags and release, its address scrubbed", async () => {
  const t = testTransport();
  start(t, "portal");
  const id = Sentry.captureException(new Error("send to noor@example.test failed"));
  await Sentry.flush(2000);
  const [event] = t.events();
  expect(event).toMatchObject({
    event_id: id,
    release: "abc123",
    tags: { service: "portal", app_version: "2027.1.0" },
  });
  expect(event!.exception!.values![0]!.value).toBe("send to [email] failed");
  expect(JSON.stringify(t.envelopes())).not.toContain("example.test");
  expect(event!.request?.headers).toBeUndefined();
  expect(lastErrorEventId()).toBe(id);
});

test("the eleventh error of a page load is dropped", async () => {
  const t = testTransport();
  start(t);
  for (let i = 1; i <= 11; i++) Sentry.captureException(new Error(`error ${i}`));
  await Sentry.flush(2000);
  expect(t.events().map((event) => event.exception!.values![0]!.value)).toEqual(
    Array.from({ length: 10 }, (_, i) => `error ${i + 1}`),
  );
});

test("a new page load counts from zero again", async () => {
  const first = testTransport();
  start(first);
  for (let i = 1; i <= 10; i++) Sentry.captureException(new Error(`first ${i}`));
  await stopBrowserMonitoring();
  const second = testTransport();
  start(second);
  Sentry.captureException(new Error("second"));
  await Sentry.flush(2000);
  expect(second.events()).toHaveLength(1);
});

test("a failed call without a connection is not reported", async () => {
  const t = testTransport();
  start(t);
  Sentry.captureException(new TypeError("Failed to fetch"));
  Sentry.captureException(new TypeError("Load failed"));
  Sentry.captureException(new TypeError("NetworkError when attempting to fetch resource."));
  await Sentry.flush(2000);
  expect(t.events()).toEqual([]);
});

test("a tap on a person's name leaves a breadcrumb without the name", async () => {
  const t = testTransport();
  start(t);
  document.body.innerHTML =
    '<ul><li class="anne"><button type="button" aria-label="Anne de Vries" title="Anne de Vries" name="anne">Anne de Vries</button></li></ul>';
  document.querySelector("button")!.click();
  Sentry.captureException(new Error("after the tap"));
  await Sentry.flush(2000);
  const crumbs = t.events()[0]!.breadcrumbs!.filter((crumb) => crumb.category === "ui.click");
  expect(crumbs).toHaveLength(1);
  expect(crumbs[0]!.message).toBe("body > ul > li > button[type][aria-label][title][name]");
  expect(JSON.stringify(t.envelopes())).not.toMatch(/anne/i);
});

test("a navigation breadcrumb and a fetch breadcrumb lose their query", async () => {
  const t = testTransport();
  start(t);
  Sentry.addBreadcrumb({
    category: "navigation",
    data: { from: "/app/more?email=a%40b.test", to: "/app/x?phone=0612345678#y" },
  });
  Sentry.addBreadcrumb({
    category: "fetch",
    type: "http",
    data: { method: "GET", url: "/api/x?phone=0612345678", status_code: 200 },
  });
  Sentry.captureException(new Error("after navigating"));
  await Sentry.flush(2000);
  const crumbs = t.events()[0]!.breadcrumbs!;
  expect(crumbs.find((crumb) => crumb.category === "navigation")!.data).toEqual({
    from: "/app/more",
    to: "/app/x",
  });
  expect(crumbs.find((crumb) => crumb.category === "fetch")!.data).toEqual({
    method: "GET",
    url: "/api/x",
    status_code: 200,
  });
});

test("the user is only the account's ID, and null clears it", async () => {
  const t = testTransport();
  start(t);
  setBrowserMonitoringUser("u1");
  Sentry.captureException(new Error("as u1"));
  // The scope is read while the event is processed, not when it is captured.
  await Sentry.flush(2000);
  setBrowserMonitoringUser(null);
  Sentry.captureException(new Error("logged out"));
  await Sentry.flush(2000);
  const [asUser, loggedOut] = t.events();
  expect(asUser!.user).toEqual({ id: "u1" });
  expect(loggedOut!.user).toBeUndefined();
});

test("lastErrorEventId names only an event that was sent", async () => {
  const t = testTransport();
  start(t);
  const ids: string[] = [];
  for (let i = 1; i <= 10; i++) ids.push(Sentry.captureException(new Error(`error ${i}`)));
  await Sentry.flush(2000);
  expect(lastErrorEventId()).toBe(ids[9]);
  // Dropped by the cap, and ignored as a network failure: neither was sent.
  Sentry.captureException(new Error("error 11"));
  Sentry.captureException(new TypeError("Failed to fetch"));
  await Sentry.flush(2000);
  expect(t.events().map((event) => event.event_id)).toEqual(ids);
  expect(lastErrorEventId()).toBe(ids[9]);
});

test("a network failure is matched as a whole message, not as part of one", async () => {
  const t = testTransport();
  start(t);
  Sentry.captureException(new TypeError("Failed to fetch dynamically imported module: /x.js"));
  await Sentry.flush(2000);
  expect(t.events()).toHaveLength(1);
});

test("a console breadcrumb keeps its scrubbed message, not its raw arguments", async () => {
  const t = testTransport();
  start(t);
  Sentry.addBreadcrumb({
    category: "console",
    level: "log",
    message: "member Anne de Vries noor@example.test",
    data: { arguments: ["member", { name: "Anne de Vries" }], logger: "console" },
  });
  Sentry.captureException(new Error("after logging"));
  await Sentry.flush(2000);
  const crumb = t.events()[0]!.breadcrumbs!.find((c) => c.category === "console")!;
  expect(crumb.data).toEqual({ logger: "console" });
  expect(crumb.message).toBe("member Anne de Vries [email]");
});

test("console output leaves no breadcrumb: it can hold names", async () => {
  const t = testTransport();
  start(t);
  // Sentry wraps console.log when it starts; replacing it here would hide the call from Sentry.
  console.log("member Anne de Vries");
  const names = Sentry.getClient()!
    .getOptions()
    .integrations.map((integration) => integration.name);
  expect(names).not.toContain("Console");
  // Taps, navigations and calls still leave breadcrumbs.
  expect(names).toContain("Breadcrumbs");
  Sentry.captureException(new Error("after logging"));
  await Sentry.flush(2000);
  expect(t.events()[0]!.breadcrumbs?.filter((c) => c.category === "console") ?? []).toEqual([]);
  expect(JSON.stringify(t.envelopes())).not.toMatch(/anne/i);
});

test("a crash is reported once per error, as unhandled, and answers its event's ID", async () => {
  const t = testTransport();
  start(t);
  const crash = new Error("render failed");
  const id = captureCrash(crash);
  // React renders an error element twice in strict mode.
  expect(captureCrash(crash)).toBe(id);
  await Sentry.flush(2000);
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]).toMatchObject({ event_id: id });
  expect(t.events()[0]!.exception!.values![0]!.mechanism).toMatchObject({ handled: false });
  // Another error is another crash.
  expect(captureCrash(new Error("render failed"))).not.toBe(id);
});

test("a crash dropped by the cap gives no event ID to link a report to", async () => {
  const t = testTransport();
  start(t);
  for (let i = 1; i <= 10; i++) Sentry.captureException(new Error(`error ${i}`));
  expect(captureCrash(new Error("the eleventh"))).toBeUndefined();
  expect(captureCrash("a thrown string")).toBeUndefined();
  // Sentry's ErrorBoundary hands its fallback the ID of an event that was never sent.
  expect(sentErrorEventId(Sentry.captureException(new Error("twelfth")))).toBeUndefined();
  expect(sentErrorEventId(undefined)).toBeUndefined();
});

test("sentErrorEventId passes the ID of an event that was sent", () => {
  const t = testTransport();
  start(t);
  const id = Sentry.captureException(new Error("caught by the boundary"));
  expect(sentErrorEventId(id)).toBe(id);
  expect(id).toMatch(/^[0-9a-f]{32}$/);
});
