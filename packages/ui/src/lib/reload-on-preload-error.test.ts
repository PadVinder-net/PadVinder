import { afterEach, expect, test, vi } from "vitest";
import { reloadOnPreloadError } from "./reload-on-preload-error";

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  window.sessionStorage.clear();
});

function preloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

test("a chunk that failed to load reloads the page once, and the error is not thrown", () => {
  const reload = vi.fn();
  let now = 1_000_000;
  uninstall = reloadOnPreloadError({ reload, now: () => now });
  const first = preloadError();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(first.defaultPrevented).toBe(true);
  // The page after the reload: it fails again at once, so the error goes through.
  now += 5_000;
  const second = preloadError();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(second.defaultPrevented).toBe(false);
  // A later deploy, much later in the same tab, reloads again.
  now += 10 * 60_000;
  preloadError();
  expect(reload).toHaveBeenCalledTimes(2);
});

test("without session storage it never reloads, so it cannot loop", () => {
  const reload = vi.fn();
  uninstall = reloadOnPreloadError({
    reload,
    storage: () => {
      throw new Error("blocked");
    },
  });
  expect(preloadError().defaultPrevented).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
