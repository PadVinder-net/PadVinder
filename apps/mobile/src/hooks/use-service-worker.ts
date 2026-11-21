import { registerSW } from "virtual:pwa-register";
import { useSyncExternalStore } from "react";
import { createServiceWorkerStore } from "./service-worker-store";

const store = createServiceWorkerStore({
  register: registerSW,
  reload: () => window.location.reload(),
  supported: "serviceWorker" in navigator,
  checkTimeoutMs: 10_000,
});

/**
 * The service worker is a device feature, so it lives here and nowhere else. The page registers it
 * once; every component shares that registration. See `service-worker-store.ts`.
 */
export function useServiceWorker() {
  const { needRefresh, checking } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { needRefresh, checking, applyUpdate: store.applyUpdate };
}
