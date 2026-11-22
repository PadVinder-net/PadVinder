import { expect, test, vi } from "vitest";
import { createTestApp, loginAs } from "../testing/login";

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
