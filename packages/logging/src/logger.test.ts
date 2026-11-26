import { expect, test } from "vitest";
import { createTestLogger } from "./testing";

test("JSON lines with service, level as a label, and scrubbed content", () => {
  const { logger, entries } = createTestLogger();
  logger.info({ to: "a@b.test", nested: { list: ["c@d.test"] } }, "Mail to e@f.test");
  const [entry] = entries();
  expect(entry).toMatchObject({ level: "info", service: "test", msg: "Mail to [email]" });
  expect(JSON.stringify(entry)).not.toMatch(/@(b|d|f)\.test/);
});
test("err goes through serializeError", () => {
  const { logger, entries } = createTestLogger();
  logger.error({ err: Object.assign(new Error("x"), { detail: "a@b.test" }) }, "failed");
  expect(entries()[0]!.err).toEqual(expect.objectContaining({ type: "Error", message: "x" }));
  expect(entries()[0]!.err).not.toHaveProperty("detail");
});
test("the request serializer leaves out address, port and headers", () => {
  const { logger, entries } = createTestLogger();
  logger.info(
    {
      req: {
        method: "GET",
        url: "/api/x?email=a@b.test",
        ip: "203.0.113.9",
        socket: { remotePort: 5 },
        headers: { cookie: "s=1" },
        host: "padvinder.test",
      },
    },
    "request completed",
  );
  const req = entries()[0]!.req as Record<string, unknown>;
  expect(req).toEqual({ method: "GET", url: "/api/x", host: "padvinder.test" });
});
test("a cyclic object is logged without throwing", () => {
  const { logger, entries } = createTestLogger();
  const cyclic: Record<string, unknown> = { to: "a@b.test" };
  cyclic.self = cyclic;
  expect(() => logger.info({ cyclic }, "cyclic")).not.toThrow();
  expect(JSON.stringify(entries()[0])).not.toContain("a@b.test");
});
test("respects the level", () => {
  const { logger, entries } = createTestLogger("warn");
  logger.info("quiet");
  logger.warn("loud");
  expect(entries().map((e) => e.msg)).toEqual(["loud"]);
});
test("an address in quotes or before a newline leaves a parseable line", () => {
  const { logger, entries, text } = createTestLogger();
  logger.info({ detail: 'rejected "a@b.test" now' }, "Mail to a@b.test\nsecond line");
  expect(text()).not.toContain("a@b.test");
  const [entry] = entries();
  expect(entry!.detail).toBe('rejected "[email]" now');
  expect(entry!.msg).toBe("Mail to [email]\nsecond line");
});
