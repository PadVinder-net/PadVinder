import { Button } from "@padvinder/ui";
import { useServiceWorker } from "../hooks/use-service-worker";

/** Shown on every tab while a new version of the app waits to be activated. */
export function UpdatePrompt() {
  const { needRefresh, checking, applyUpdate } = useServiceWorker();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b bg-secondary p-3"
    >
      <p>Er is een nieuwe versie.</p>
      <Button
        size="lg"
        className="h-12 text-base"
        disabled={checking}
        onClick={() => void applyUpdate()}
      >
        {checking ? "Even geduld…" : "Werk de app bij"}
      </Button>
    </div>
  );
}
