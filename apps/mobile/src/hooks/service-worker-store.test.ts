import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createServiceWorkerStore } from "./service-worker-store";

type Callbacks = {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup({ supported = true }: { supported?: boolean } = {}) {
  let callbacks: Callbacks = {};
  const updateSW = vi.fn(async () => {});
  const register = vi.fn((options: Callbacks) => {
    callbacks = options;
    return updateSW;
  });
  const reload = vi.fn();
  const registration = { update: vi.fn(async () => {}) };
  const store = createServiceWorkerStore({ register, reload, supported, checkTimeoutMs: 5000 });
  store.start();
  callbacks.onRegisteredSW?.("/app/sw.js", registration as unknown as ServiceWorkerRegistration);
  return { store, register, updateSW, reload, registration, callbacks: () => callbacks };
}

test("registers only once, however often it is started", () => {
  const { store, register } = setup();
  store.start();
  expect(register).toHaveBeenCalledOnce();
});

test("reports a waiting version", () => {
  const { store, callbacks } = setup();
  expect(store.getSnapshot().needRefresh).toBe(false);
  callbacks().onNeedRefresh?.();
  expect(store.getSnapshot().needRefresh).toBe(true);
});

test("a waiting worker is told to skip waiting, without an immediate reload", async () => {
  const { store, callbacks, updateSW, reload } = setup();
  callbacks().onNeedRefresh?.();
  await store.applyUpdate();
  expect(updateSW).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  expect(store.getSnapshot().checking).toBe(true);
});

test("reloads after skip-waiting when no controlling event reloads the page", async () => {
  const { store, callbacks, reload } = setup();
  callbacks().onNeedRefresh?.();
  await store.applyUpdate();
  await vi.advanceTimersByTimeAsync(4999);
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(reload).toHaveBeenCalledOnce();
  expect(store.getSnapshot().checking).toBe(false);
});

test("reloads when fetching the new worker never finishes", async () => {
  const { store, registration, reload } = setup();
  registration.update.mockReturnValue(new Promise(() => {}));
  const done = store.applyUpdate();
  await vi.advanceTimersByTimeAsync(5000);
  await done;
  expect(reload).toHaveBeenCalledOnce();
  expect(store.getSnapshot().checking).toBe(false);
});

test("a worker found after skip-waiting still falls back to one reload", async () => {
  const { store, callbacks, reload } = setup();
  const done = store.applyUpdate();
  await vi.advanceTimersByTimeAsync(1000);
  callbacks().onNeedRefresh?.();
  await done;
  await vi.advanceTimersByTimeAsync(5000);
  expect(reload).toHaveBeenCalledOnce();
});

test("no stale timer reloads again after an update path has finished", async () => {
  const { store, reload } = setup();
  const done = store.applyUpdate();
  await vi.advanceTimersByTimeAsync(5000);
  await done;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).toHaveBeenCalledOnce();
});

test("a second tap while checking does nothing", async () => {
  const { store, registration } = setup();
  void store.applyUpdate();
  await store.applyUpdate();
  expect(registration.update).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
});

test("without a waiting worker it checks for an update, then skips waiting when one installs", async () => {
  const { store, callbacks, registration, updateSW, reload } = setup();
  const done = store.applyUpdate();
  await vi.advanceTimersByTimeAsync(0);
  expect(registration.update).toHaveBeenCalledOnce();
  expect(store.getSnapshot().checking).toBe(true);
  callbacks().onNeedRefresh?.();
  await done;
  expect(updateSW).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
});

test("reloads when no update appears within the time limit", async () => {
  const { store, updateSW, reload } = setup();
  const done = store.applyUpdate();
  await vi.advanceTimersByTimeAsync(5000);
  await done;
  expect(updateSW).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledOnce();
  expect(store.getSnapshot().checking).toBe(false);
});

test("reloads when the update check fails", async () => {
  const { store, registration, reload } = setup();
  registration.update.mockRejectedValue(new Error("offline"));
  await store.applyUpdate();
  expect(reload).toHaveBeenCalledOnce();
});

test("reloads when service workers are not supported", async () => {
  const { store, reload, updateSW } = setup({ supported: false });
  await store.applyUpdate();
  expect(reload).toHaveBeenCalledOnce();
  expect(updateSW).not.toHaveBeenCalled();
});

test("reloads when there is no registration", async () => {
  let callbacks: Callbacks = {};
  const reload = vi.fn();
  const store = createServiceWorkerStore({
    register: (options: Callbacks) => {
      callbacks = options;
      return async () => {};
    },
    reload,
    supported: true,
    checkTimeoutMs: 5000,
  });
  store.start();
  await store.applyUpdate();
  expect(callbacks.onRegisteredSW).toBeDefined();
  expect(reload).toHaveBeenCalledOnce();
});

test("notifies subscribers and gives a stable snapshot between changes", () => {
  const { store, callbacks } = setup();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const before = store.getSnapshot();
  expect(store.getSnapshot()).toBe(before);
  callbacks().onNeedRefresh?.();
  expect(listener).toHaveBeenCalledOnce();
  expect(store.getSnapshot()).not.toBe(before);
  unsubscribe();
});
