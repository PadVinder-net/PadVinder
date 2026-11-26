import { expect, test } from "vitest";
import { createWindowLimiter } from "./window-limiter";

test("allows max per window per key, then refuses until the window has passed", () => {
  let now = 1_000_000;
  const limiter = createWindowLimiter({ max: 3, windowMs: 60_000, now: () => now });
  expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([true, true, true, false]);
  expect(limiter.take("b")).toBe(true);
  now += 59_999;
  expect(limiter.take("a")).toBe(false);
  now += 1;
  expect(limiter.take("a")).toBe(true);
});

test("forgets keys whose window has passed", () => {
  let now = 0;
  const limiter = createWindowLimiter({ max: 1, windowMs: 1_000, now: () => now });
  for (let i = 0; i < 100; i++) limiter.take(`key-${i}`);
  expect(limiter.size()).toBe(100);
  now += 1_000;
  limiter.take("fresh");
  expect(limiter.size()).toBe(1);
});
