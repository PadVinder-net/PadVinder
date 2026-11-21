export type ServiceWorkerSnapshot = {
  /** A new version is installed and waiting. */
  needRefresh: boolean;
  /** `applyUpdate` is looking for a new version. */
  checking: boolean;
};

type RegisterOptions = {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
};

type Deps = {
  /** `registerSW` from `virtual:pwa-register`. Returns the function that sends skip-waiting. */
  register: (options: RegisterOptions) => (reloadPage?: boolean) => Promise<void>;
  reload: () => void;
  supported: boolean;
  /** How long to wait for a new version to install after an update check. */
  checkTimeoutMs: number;
};

/**
 * One service-worker registration per page, shared by every component that needs it.
 *
 * Updating: when a worker waits, we only send skip-waiting; the library reloads the page on the
 * `controlling` event, once the new worker serves it; a bounded fallback reloads if that never comes.
 * Reloading earlier would be answered by the old worker. When nothing waits yet, we ask the browser
 * to check, and reload ourselves only if nothing turns up in time (or service workers are
 * unavailable). Every wait is bounded, so the update button never stays disabled.
 */
export function createServiceWorkerStore({ register, reload, supported, checkTimeoutMs }: Deps) {
  let snapshot: ServiceWorkerSnapshot = { needRefresh: false, checking: false };
  const listeners = new Set<() => void>();
  let started = false;
  let registration: ServiceWorkerRegistration | undefined;
  let skipWaiting: ((reloadPage?: boolean) => Promise<void>) | undefined;

  function update(change: Partial<ServiceWorkerSnapshot>) {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  }

  function start() {
    if (started || !supported) return;
    started = true;
    skipWaiting = register({
      onNeedRefresh: () => update({ needRefresh: true }),
      onRegisteredSW: (_url, reg) => {
        registration = reg;
      },
    });
  }

  function waitForNeedRefresh() {
    let cancel = () => {};
    const promise = new Promise<"found">((resolve) => {
      const check = () => {
        if (snapshot.needRefresh) {
          listeners.delete(check);
          resolve("found");
        }
      };
      cancel = () => listeners.delete(check);
      listeners.add(check);
      check();
    });
    return { promise, cancel };
  }

  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  function giveUp() {
    clearTimeout(fallbackTimer);
    update({ checking: false });
    reload();
  }

  /**
   * Sends skip-waiting. The library reloads on `controlling`, but only when the page had a
   * controller to begin with; if no reload happens in time we reload ourselves.
   * (If the library's reload happens, the page unloads and this timer goes with it.)
   */
  async function skipWaitingThenReload() {
    update({ checking: true });
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(giveUp, checkTimeoutMs);
    await skipWaiting?.(true);
  }

  async function applyUpdate() {
    if (snapshot.checking) return;
    if (snapshot.needRefresh && skipWaiting) return skipWaitingThenReload();
    if (!registration) return reload();

    update({ checking: true });
    // One deadline covers both fetching the new service worker and its installation.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      deadlineTimer = setTimeout(() => resolve("timeout"), checkTimeoutMs);
    });
    const waiting = waitForNeedRefresh();
    try {
      const checked = await Promise.race([
        registration.update().then(
          () => "ok" as const,
          () => "failed" as const,
        ),
        deadline,
      ]);
      const result = checked === "ok" ? await Promise.race([waiting.promise, deadline]) : checked;
      if (result === "found") {
        await skipWaitingThenReload();
        return;
      }
    } finally {
      clearTimeout(deadlineTimer);
      waiting.cancel();
    }
    giveUp();
  }

  return {
    start,
    applyUpdate,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
