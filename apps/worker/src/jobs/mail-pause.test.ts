import { expect, test } from "vitest";
import { waitUntilElapsed } from "./mail";

/** A clock whose timers fire `early` ms before the time they were set for, as Node's can. */
function earlyClock(start: number, early: number) {
  let time = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => time,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        time += Math.max(ms - early, 1);
      },
    },
  };
}

test("a timer that fires early is slept again, so the whole pause passes", async () => {
  const { clock, sleeps } = earlyClock(10_000, 1);
  await waitUntilElapsed(10_000, 2_000, clock);
  expect(clock.now() - 10_000).toBeGreaterThanOrEqual(2_000);
  expect(sleeps).toEqual([2_000, 1]);
});

test("nothing is slept when the pause has already passed", async () => {
  const { clock, sleeps } = earlyClock(13_000, 1);
  await waitUntilElapsed(10_000, 2_000, clock);
  expect(sleeps).toEqual([]);
});

test("only what is left of the pause is slept", async () => {
  const { clock, sleeps } = earlyClock(11_500, 0);
  await waitUntilElapsed(10_000, 2_000, clock);
  expect(sleeps).toEqual([500]);
  expect(clock.now()).toBe(12_000);
});
