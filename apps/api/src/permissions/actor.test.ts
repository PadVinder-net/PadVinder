import type { Db } from "@padvinder/db";
import type { FastifyRequest } from "fastify";
import { expect, test, vi } from "vitest";
import { createTestApp, loginAs } from "../testing/login";
import { stampSession } from "../testing/passkeys";
import { loadActor } from "./actor";

test("a database failure while loading the actor is 500, not 401", async () => {
  const ctx = await createTestApp();
  try {
    const noor = await loginAs(ctx, "noor@example.test");
    // The session is valid, but the database stops answering.
    vi.spyOn(ctx.t.pool, "query").mockRejectedValue(new Error("connection refused"));
    vi.spyOn(ctx.t.pool, "connect").mockRejectedValue(new Error("connection refused"));
    for (const url of ["/api/me", "/api/events"]) {
      const res = await ctx.app.inject({ url, headers: noor.headers });
      expect(res.statusCode, url).toBe(500);
      expect(res.json()).toMatchObject({ statusCode: 500, code: "internal_error" });
    }
  } finally {
    vi.restoreAllMocks();
    await ctx.close();
  }
});

test("a cookie that is not a signed session is 401", async () => {
  const ctx = await createTestApp();
  try {
    const res = await ctx.app.inject({
      url: "/api/me",
      headers: { cookie: "padvinder.session_token=abc.def" },
    });
    expect(res.statusCode).toBe(401);
  } finally {
    await ctx.close();
  }
});

test("the actor carries the profile, memberships, admin rows and the platform flag", async () => {
  const ctx = await createTestApp();
  try {
    const noor = await loginAs(ctx, "noor@example.test");
    const actor = await loadActor(ctx.app, ctx.t.db, { headers: noor.headers } as FastifyRequest);
    expect(actor).toEqual({
      userId: noor.userId,
      user: { id: noor.userId, name: "Test Persoon", email: "noor@example.test", phone: null },
      passkeyVerifiedAt: null,
      now: expect.any(Date),
      isPlatformAdmin: false,
      memberships: [],
      adminOfOrganizationIds: [],
    });
    await ctx.t.pool.query("update users set is_platform_admin = true where id = $1", [
      noor.userId,
    ]);
    expect(
      (await loadActor(ctx.app, ctx.t.db, { headers: noor.headers } as FastifyRequest))
        ?.isPlatformAdmin,
    ).toBe(true);
  } finally {
    await ctx.close();
  }
});

test("a valid session whose user row is gone is no actor", async () => {
  const ctx = await createTestApp();
  try {
    const noor = await loginAs(ctx, "noor@example.test");
    // The session is valid for Better Auth, but getAccess finds no user: a database that
    // answers every select with no rows.
    const empty = { select: () => ({ from: () => ({ where: async () => [] }) }) } as unknown as Db;
    expect(await loadActor(ctx.app, empty, { headers: noor.headers } as FastifyRequest)).toBeNull();
    expect(
      await loadActor(ctx.app, ctx.t.db, { headers: noor.headers } as FastifyRequest),
    ).not.toBeNull();
  } finally {
    await ctx.close();
  }
});

test("a database failure while loading access is 500, not 401 or 403", async () => {
  const ctx = await createTestApp();
  try {
    const noor = await loginAs(ctx, "noor@example.test");
    const query = ctx.t.pool.query.bind(ctx.t.pool) as (...args: unknown[]) => unknown;
    // Only the memberships query fails: the session itself loads fine.
    vi.spyOn(ctx.t.pool, "query").mockImplementation(((...args: unknown[]) => {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
      if (text?.includes("working_group_memberships")) {
        return Promise.reject(new Error("connection refused"));
      }
      return query(...args);
    }) as never);
    const res = await ctx.app.inject({ url: "/api/me", headers: noor.headers });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "internal_error" });
  } finally {
    vi.restoreAllMocks();
    await ctx.close();
  }
});

test("the actor carries the session's passkeyVerifiedAt, and null for a code session", async () => {
  const ctx = await createTestApp();
  try {
    const noor = await loginAs(ctx, "noor@example.test");
    const load = () => loadActor(ctx.app, ctx.t.db, { headers: noor.headers } as FastifyRequest);
    expect((await load())?.passkeyVerifiedAt).toBeNull();
    const at = new Date("2026-11-26T10:00:00.000Z");
    await stampSession(ctx, noor.headers.cookie, at);
    const actor = await load();
    expect(actor?.passkeyVerifiedAt).toEqual(at);
    expect(actor?.now).toBeInstanceOf(Date);
    await stampSession(ctx, noor.headers.cookie, null);
    expect((await load())?.passkeyVerifiedAt).toBeNull();
  } finally {
    await ctx.close();
  }
});
