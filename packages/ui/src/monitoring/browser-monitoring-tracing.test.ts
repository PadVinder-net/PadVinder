import * as Sentry from "@sentry/react";
import { afterEach, expect, test, vi } from "vitest";
import { startBrowserMonitoring, stopBrowserMonitoring } from "./browser-monitoring";

vi.mock("@sentry/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@sentry/react")>();
  return {
    ...original,
    browserTracingIntegration: vi.fn(original.browserTracingIntegration),
    reactRouterBrowserTracingIntegration: vi.fn(original.reactRouterBrowserTracingIntegration),
  };
});

afterEach(async () => {
  await stopBrowserMonitoring();
});

const base = { app: "app", appVersion: "2027.1.0", release: "abc", enabled: true } as const;

// INP is sent as a span of its own, which the tunnel drops, carrying the tapped element's
// selector and the user agent until then.
test("INP is not measured, with or without React Router", () => {
  startBrowserMonitoring(base);
  expect(Sentry.browserTracingIntegration).toHaveBeenCalledWith(
    expect.objectContaining({ webVitals: { ignore: ["inp"] } }),
  );
  const router = {
    useLocation: vi.fn(),
    useNavigationType: vi.fn(),
    createRoutesFromChildren: vi.fn(),
    matchRoutes: vi.fn(),
  } as unknown as NonNullable<Parameters<typeof startBrowserMonitoring>[0]["router"]>;
  startBrowserMonitoring({ ...base, router });
  expect(Sentry.reactRouterBrowserTracingIntegration).toHaveBeenCalledWith(
    expect.objectContaining({ ...router, webVitals: { ignore: ["inp"] } }),
  );
});
