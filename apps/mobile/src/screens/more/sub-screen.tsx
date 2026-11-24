import { apiErrorCode } from "@padvinder/api-client";
import { apiErrorMessage, Button } from "@padvinder/ui";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

/** A screen below the Meer menu, with a link back to the screen above it. */
export function SubScreen({ back, children }: { back: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <Button asChild variant="outline" className="h-12 self-start px-5 text-lg">
        <Link to={back}>Terug</Link>
      </Button>
      {children}
    </section>
  );
}

/** A loading text, in the same size as the screens. */
export function Loading({ children }: { children: ReactNode }) {
  return <p className="text-lg">{children}</p>;
}

/**
 * What the API answered, in Dutch: "Dit mag je niet doen.", "Dit bestaat niet meer." or the
 * connection text. Without an answer from the API (no connection) there is a retry button.
 */
export function LoadError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const code = apiErrorCode(error);
  return (
    <div className="flex flex-col gap-4 text-lg">
      <p role="alert">{apiErrorMessage(code)}</p>
      {code === null ? (
        <Button size="lg" className="h-14 w-full text-lg" onClick={onRetry}>
          Probeer opnieuw
        </Button>
      ) : null}
    </div>
  );
}

/** Where a screen sends the user back to a list with a message, such as "{naam} is toegelaten." */
export type FlashState = { message: string };

/** The message another screen passed along when it navigated here. */
export function FlashMessage() {
  const state = useLocation().state as Partial<FlashState> | null;
  if (typeof state?.message !== "string") return null;
  return (
    <p role="status" className="rounded-lg border bg-card px-4 py-3 text-lg font-medium">
      {state.message}
    </p>
  );
}
