import { Button, connectionMessage } from "@padvinder/ui";

/** A list that failed to load: the connection text and a button to load it again. */
export function LoadError({ onRetry }: { onRetry(): void }) {
  return (
    <div className="flex flex-col items-start gap-4 text-lg">
      <p role="alert">{connectionMessage}</p>
      <Button size="lg" onClick={onRetry}>
        Probeer opnieuw
      </Button>
    </div>
  );
}
