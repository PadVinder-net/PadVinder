import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { healthyFixture, workerStaleFixture } from "@padvinder/contracts/fixtures";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getHealthQueryKey, getMeQueryKey } from "./generated/@tanstack/react-query.gen";
import { useHealthLiveUpdates } from "./health-live-updates";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-01T19:31:05Z"));
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useHealthLiveUpdates(), { wrapper }) };
}

test("applies a heartbeat to the cached health", () => {
  const { client } = setup();
  client.setQueryData(getHealthQueryKey(), workerStaleFixture);
  FakeEventSource.instances[0]!.emit(
    "worker-heartbeat",
    JSON.stringify({ type: "worker-heartbeat", beatAt: new Date().toISOString() }),
  );
  expect(client.getQueryData<typeof healthyFixture>(getHealthQueryKey())?.status).toBe("ok");
});

test("does nothing when nothing is cached", () => {
  const { client } = setup();
  FakeEventSource.instances[0]!.emit(
    "worker-heartbeat",
    JSON.stringify({ type: "worker-heartbeat", beatAt: new Date().toISOString() }),
  );
  expect(client.getQueryData(getHealthQueryKey())).toBeUndefined();
});

test("refetches the health when the connection opens", () => {
  const { client } = setup();
  const spy = vi.spyOn(client, "invalidateQueries");
  FakeEventSource.instances[0]!.onopen?.();
  expect(spy).toHaveBeenCalledWith({ queryKey: getHealthQueryKey() });
});

test("asks for me again when the stream is closed for good", () => {
  // A logout elsewhere: the stream's next connect gets a 401, and me leads to the login screen.
  const { client } = setup();
  const spy = vi.spyOn(client, "invalidateQueries");
  const source = FakeEventSource.instances[0]!;
  source.readyState = 2;
  source.onerror?.();
  expect(spy).toHaveBeenCalledWith({ queryKey: getMeQueryKey() });
});

test("closes the connection on unmount", () => {
  const { unmount } = setup();
  unmount();
  expect(FakeEventSource.instances[0]!.closed).toBe(true);
});
