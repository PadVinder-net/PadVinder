import { renderHook } from "@testing-library/react";
import * as Sentry from "@sentry/react";
import { afterEach, expect, test } from "vitest";
import { startBrowserMonitoring, stopBrowserMonitoring } from "./browser-monitoring";
import { useBrowserMonitoringUser } from "./use-browser-monitoring-user";

afterEach(async () => {
  await stopBrowserMonitoring();
});

test("sets the logged-in account's ID, keeps it while me is unknown, clears it on logging out", () => {
  startBrowserMonitoring({ app: "app", appVersion: "2027.1.0", release: "abc", enabled: true });
  const user = () => Sentry.getIsolationScope().getUser()?.id;
  const { rerender } = renderHook((id: string | null | undefined) => useBrowserMonitoringUser(id), {
    initialProps: undefined as string | null | undefined,
  });
  expect(user()).toBeUndefined();
  rerender("u1");
  expect(user()).toBe("u1");
  // A failed refetch of me (no connection): who is logged in did not change.
  rerender(undefined);
  expect(user()).toBe("u1");
  rerender(null);
  expect(user()).toBeUndefined();
});
