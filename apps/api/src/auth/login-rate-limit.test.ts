import { countLoginCodeRequests, loginCodeRequests, rateLimits, sessions } from "@padvinder/db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { codeFor, createTestApp, requestCode, type TestApp } from "../testing/login";
import { checkLoginCodeRequest, IP_LIMITS, LOGIN_CODE_LIMITS } from "./login-rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const ip = (address: string) => ({ "x-forwarded-for": address });
const countAll = async (email: string) =>
  (await countLoginCodeRequests(ctx.t.db, email, { all: new Date(0) })).all;

// Loops of many requests take longer than the default 5 seconds.
const LONG = 30_000;

let ctx: TestApp;
afterEach(async () => {
  await ctx?.close();
});

function signInFrom(address: string, email: string, code: string) {
  return ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: ip(address),
    payload: { email, otp: code },
  });
}

describe("with the limits on", () => {
  beforeEach(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMITS: "on" });
  });

  test("the limits are the ones in the design", () => {
    expect(LOGIN_CODE_LIMITS).toEqual({ perQuarterHour: 3, perDay: 10 });
    expect(IP_LIMITS).toEqual({
      sendCode: { window: 300, max: 30 },
      checkCode: { window: 300, max: 60 },
    });
  });

  test("the fourth code for one address within 15 minutes is refused, and nothing is sent", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestCode(ctx, "a@example.test", ip("10.0.0.1"))).statusCode).toBe(200);
    }
    const res = await requestCode(ctx, "a@example.test", ip("10.0.0.2"));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      code: "TOO_MANY_LOGIN_CODES",
      message: "Too many login codes requested for this address in 15 minutes",
    });
    expect(ctx.mailer.sent).toHaveLength(3);
    // The refused request is not counted.
    expect(await countAll("a@example.test")).toBe(3);
  });

  test("five requests at once for one address give exactly three codes", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => requestCode(ctx, "a@example.test", ip("10.0.0.1"))),
    );
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 200, 200, 429, 429]);
    expect(ctx.mailer.sent).toHaveLength(3);
    expect(await ctx.t.db.select().from(loginCodeRequests)).toHaveLength(3);
  });

  test.each([
    ["a malformed address", "not-an-email"],
    ["300 characters without an @", "a".repeat(300)],
    ["an address longer than 254 characters", `${"a".repeat(290)}@example.test`],
    ["an address of 3000 characters", `${"a".repeat(3000)}@example.test`],
  ])("%s is refused with 400 and not recorded", async (_name, email) => {
    const res = await requestCode(ctx, email, ip("10.0.0.1"));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "INVALID_EMAIL", message: "Invalid email" });
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(await ctx.t.db.select().from(loginCodeRequests)).toHaveLength(0);
  });

  test("an address of exactly 254 characters is accepted", async () => {
    const email = `${"a".repeat(254 - "@example.test".length)}@example.test`;
    expect((await requestCode(ctx, email, ip("10.0.0.1"))).statusCode).toBe(200);
  });

  test.each([
    ["an accepted", 0],
    ["a refused", 3],
  ])("%s request prunes requests and IP counters older than 24 hours", async (_name, earlier) => {
    const now = new Date();
    for (let i = 0; i < earlier; i++) {
      await checkLoginCodeRequest(ctx.t.db, "a@example.test", now);
    }
    const old = now.getTime() - 25 * HOUR_MS;
    await ctx.t.db
      .insert(loginCodeRequests)
      .values({ email: "old@example.test", requestedAt: new Date(old) });
    await ctx.t.db.insert(rateLimits).values([
      { key: "10.0.0.1|/old", count: 1, lastRequest: old },
      { key: "10.0.0.1|/recent", count: 1, lastRequest: now.getTime() - HOUR_MS },
    ]);
    const expected = earlier === 3 ? "quarterHour" : "ok";
    expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", now)).toBe(expected);
    expect(await countAll("old@example.test")).toBe(0);
    const keys = (await ctx.t.db.select().from(rateLimits)).map((row) => row.key);
    expect(keys).toEqual(["10.0.0.1|/recent"]);
  });

  test("an eleventh code within 24 hours is refused with its own code", async () => {
    const now = Date.now();
    await ctx.t.db.insert(loginCodeRequests).values(
      Array.from({ length: 10 }, (_, i) => ({
        email: "a@example.test",
        requestedAt: new Date(now - (i + 1) * HOUR_MS),
      })),
    );
    const res = await requestCode(ctx, "a@example.test", ip("10.0.0.1"));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      code: "TOO_MANY_LOGIN_CODES_TODAY",
      message: "Too many login codes requested for this address in 24 hours",
    });
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  test("another address is not affected", async () => {
    for (let i = 0; i < 3; i++) await requestCode(ctx, "a@example.test", ip("10.0.0.1"));
    expect((await requestCode(ctx, "a@example.test", ip("10.0.0.1"))).statusCode).toBe(429);
    expect((await requestCode(ctx, "b@example.test", ip("10.0.0.1"))).statusCode).toBe(200);
    expect(ctx.mailer.sent.map((mail) => mail.to)).toContain("b@example.test");
  });

  test("capital letters do not dodge the limit", async () => {
    for (const email of ["a@example.test", " A@Example.test", "A@EXAMPLE.TEST "]) {
      expect((await requestCode(ctx, email, ip("10.0.0.1"))).statusCode).toBe(200);
    }
    expect((await requestCode(ctx, "a@Example.Test", ip("10.0.0.1"))).statusCode).toBe(429);
    expect(await countAll("a@example.test")).toBe(3);
  });

  test("checkLoginCodeRequest allows 3 per quarter of an hour", async () => {
    const start = new Date("2027-03-01T20:00:00+01:00");
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    for (const minute of [0, 1, 2]) {
      expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at(minute))).toBe("ok");
    }
    expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at(14))).toBe("quarterHour");
    expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at(15.5))).toBe("ok");
  });

  test("checkLoginCodeRequest allows 10 per day", async () => {
    const start = new Date("2027-03-01T08:00:00+01:00");
    const at = (hours: number) => new Date(start.getTime() + hours * HOUR_MS);
    // 10 calls spread over 20 hours, far enough apart for the quarter-hour limit.
    for (let i = 0; i < 10; i++) {
      expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at((i * 20) / 9))).toBe("ok");
    }
    expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at(20.5))).toBe("day");
    // Counts first, records only when the answer is "ok".
    expect(await countAll("a@example.test")).toBe(10);
    // 25 hours after the first, that one no longer counts.
    expect(await checkLoginCodeRequest(ctx.t.db, "a@example.test", at(25))).toBe("ok");
  });

  test(
    "one IP address is refused after 30 code requests in 5 minutes",
    async () => {
      for (let i = 0; i < 30; i++) {
        expect((await requestCode(ctx, `p${i}@example.test`, ip("10.0.0.9"))).statusCode).toBe(200);
      }
      const res = await requestCode(ctx, "p30@example.test", ip("10.0.0.9"));
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ message: "Too many requests. Please try again later." });
      expect(Number(res.headers["x-retry-after"])).toBeGreaterThan(0);
      expect(ctx.mailer.sent).toHaveLength(30);
      // Another address on the network is not affected, and the counter is in the database.
      expect((await requestCode(ctx, "p30@example.test", ip("10.0.0.10"))).statusCode).toBe(200);
      expect((await ctx.t.db.select().from(rateLimits)).length).toBeGreaterThan(0);
    },
    LONG,
  );

  test(
    "one IP address is refused after 60 code checks in 5 minutes",
    async () => {
      for (let i = 0; i < 60; i++) {
        const res = await signInFrom("10.0.0.9", `p${i}@example.test`, "000000");
        expect(res.statusCode).not.toBe(429);
      }
      const refused = await signInFrom("10.0.0.9", "p60@example.test", "000000");
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({ message: "Too many requests. Please try again later." });
      expect(Number(refused.headers["x-retry-after"])).toBeGreaterThan(0);
      expect((await signInFrom("10.0.0.10", "p60@example.test", "000000")).statusCode).not.toBe(
        429,
      );
    },
    LONG,
  );

  test("signing in is not held to Better Auth's own stricter default", async () => {
    // Better Auth's email OTP plugin allows 3 sign-ins per minute per IP by default.
    await requestCode(ctx, "a@example.test", ip("10.0.0.1"));
    const code = codeFor(ctx, "a@example.test");
    for (let i = 0; i < 3; i++) await signInFrom("10.0.0.1", "b@example.test", "000000");
    expect((await signInFrom("10.0.0.1", "a@example.test", code)).statusCode).toBe(200);
  });

  test("signing out is not limited", async () => {
    // Better Auth's global default (100 per 10 seconds) would count it; nothing is counted.
    for (let i = 0; i < 3; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { ...ip("10.0.0.1"), origin: "http://localhost:4101" },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await ctx.t.db.select().from(rateLimits)).toHaveLength(0);
  });
});

describe("with LOGIN_RATE_LIMITS=off", () => {
  beforeEach(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMITS: "off" });
  });

  test(
    "with LOGIN_RATE_LIMITS=off nothing is limited",
    async () => {
      for (let i = 0; i < 5; i++) {
        expect((await requestCode(ctx, "a@example.test", ip("10.0.0.1"))).statusCode).toBe(200);
      }
      expect(ctx.mailer.sent).toHaveLength(5);
      for (let i = 0; i < 31; i++) {
        expect((await requestCode(ctx, `p${i}@example.test`, ip("10.0.0.9"))).statusCode).toBe(200);
      }
      expect(await countAll("a@example.test")).toBe(0);
      expect(await ctx.t.db.select().from(rateLimits)).toHaveLength(0);
    },
    LONG,
  );

  test(
    "the five tries per code hold with the limits off",
    async () => {
      await requestCode(ctx, "a@example.test");
      const right = codeFor(ctx, "a@example.test");
      const wrong = right === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) {
        expect((await signInFrom("10.0.0.1", "a@example.test", wrong)).json()).toMatchObject({
          code: "INVALID_OTP",
        });
      }
      const res = await signInFrom("10.0.0.1", "a@example.test", right);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).not.toBe(429);
      expect(res.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
      expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
    },
    LONG,
  );
});
