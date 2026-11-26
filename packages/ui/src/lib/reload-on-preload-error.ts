const KEY = "padvinder:preload-error-reload";
// A page that fails again this soon after its reload is broken, not out of date.
const AGAIN_AFTER_MS = 60_000;

/**
 * A chunk that fails to load after a deploy (the old page asks for a file the new release no
 * longer has) reloads the page once instead of crashing it. The time of the reload is kept in
 * session storage, so a page that fails again right after its reload shows the error instead of
 * reloading forever; without session storage it never reloads. Returns a function that removes
 * the listener.
 */
export function reloadOnPreloadError({
  reload = () => window.location.reload(),
  storage = () => window.sessionStorage,
  now = Date.now,
}: {
  reload?: () => void;
  storage?: () => Storage;
  now?: () => number;
} = {}): () => void {
  const onPreloadError = (event: Event) => {
    try {
      const store = storage();
      const last = Number(store.getItem(KEY));
      if (Number.isFinite(last) && last > 0 && now() - last < AGAIN_AFTER_MS) return;
      store.setItem(KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    reload();
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
