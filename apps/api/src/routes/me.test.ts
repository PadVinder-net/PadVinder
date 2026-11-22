import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const patch = (headers: Record<string, string>, payload: unknown) =>
  ctx.app.inject({ method: "PATCH", url: "/api/me", headers, payload: payload as object });

test("401 without a login", async () => {
  const res = await ctx.app.inject("/api/me");
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ statusCode: 401, code: "not_logged_in" });
});

test("PATCH without a login is 401", async () => {
  const res = await patch({}, { name: "X" });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "not_logged_in" });
});

test("returns the logged-in user", async () => {
  const noor = await loginAs(ctx, "noor@example.test", { name: "Noor de Vries" });
  const res = await ctx.app.inject({ url: "/api/me", headers: noor.headers });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    user: { id: noor.userId, name: "Noor de Vries", email: "noor@example.test", phone: null },
  });
});

test("PATCH changes only what is sent", async () => {
  const user = await loginAs(ctx, "patch@example.test", { name: "Piet" });
  const first = await patch(user.headers, { phone: "06 1" });
  expect(first.statusCode).toBe(200);
  expect(first.json().user).toMatchObject({ name: "Piet", phone: "06 1" });
  const second = await patch(user.headers, { name: " Pieter " });
  expect(second.json().user).toMatchObject({ name: "Pieter", phone: "06 1" });
  const cleared = await patch(user.headers, { phone: null });
  expect(cleared.json().user).toMatchObject({ name: "Pieter", phone: null });
  const blank = await patch(user.headers, { phone: "06 2" });
  expect(blank.json().user.phone).toBe("06 2");
  expect((await patch(user.headers, { phone: "  " })).json().user.phone).toBeNull();
});

test("PATCH rejects an unknown key and an empty body with 400", async () => {
  const user = await loginAs(ctx, "strict@example.test", { name: "Strict" });
  for (const body of [{ nam: "x" }, {}, { name: "" }, { name: null }, { name: "a", extra: 1 }]) {
    const res = await patch(user.headers, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
  }
  const me = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(me.json().user.name).toBe("Strict");
});

test("PATCH with the same body twice gives the same result", async () => {
  const user = await loginAs(ctx, "twice@example.test", { name: "Twice" });
  const one = await patch(user.headers, { name: "Dubbel", phone: "06 3" });
  const two = await patch(user.headers, { name: "Dubbel", phone: "06 3" });
  expect(two.statusCode).toBe(200);
  expect(two.json()).toEqual(one.json());
});

test("PATCH never changes another user", async () => {
  const a = await loginAs(ctx, "a@example.test", { name: "A" });
  const b = await loginAs(ctx, "b@example.test", { name: "B", phone: "06 9" });
  await patch(a.headers, { name: "A2", phone: "06 1" });
  const res = await ctx.app.inject({ url: "/api/me", headers: b.headers });
  expect(res.json().user).toMatchObject({ id: b.userId, name: "B", phone: "06 9" });
});

test("PATCH from a foreign Origin is refused", async () => {
  const user = await loginAs(ctx, "origin@example.test", { name: "Origin" });
  const res = await patch({ ...user.headers, origin: "https://evil.example" }, { name: "Hacked" });
  expect(res.statusCode).toBe(403);
  const me = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(me.json().user.name).toBe("Origin");
});

test("a session does not set a cookie on GET", async () => {
  const user = await loginAs(ctx, "cookie@example.test");
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.headers["set-cookie"]).toBeUndefined();
});

/** Moves the user's session into Better Auth's renewal window (older than `updateAge`). */
async function ageSession(userId: string) {
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(old.getTime() + 180 * 24 * 60 * 60 * 1000);
  await ctx.t.pool.query(
    "update sessions set updated_at = $1, expires_at = $2 where user_id = $3",
    [old, expiresAt, userId],
  );
  return expiresAt;
}

test("an old session is renewed and GET /api/me sets a fresh cookie", async () => {
  const user = await loginAs(ctx, "renew@example.test");
  const oldExpiry = await ageSession(user.userId);
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.statusCode).toBe(200);
  expect(String(res.headers["set-cookie"])).toContain("padvinder.session_token=");
  const { rows } = await ctx.t.pool.query("select expires_at from sessions where user_id = $1", [
    user.userId,
  ]);
  expect(rows[0].expires_at.getTime()).toBeGreaterThan(oldExpiry.getTime());
});
