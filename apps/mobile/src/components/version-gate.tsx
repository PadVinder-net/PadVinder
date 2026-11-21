import { getVersionOptions } from "@padvinder/api-client";
import { compareCalVer } from "@padvinder/contracts";
import { Button } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { APP_VERSION } from "../app-version";
import { useServiceWorker } from "../hooks/use-service-worker";

function isOutdated(minimumAppVersion: string | undefined): boolean {
  if (minimumAppVersion === undefined) return false;
  try {
    return compareCalVer(APP_VERSION, minimumAppVersion) < 0;
  } catch {
    // A malformed version must not lock volunteers out.
    return false;
  }
}

/**
 * Replaces the app with an update screen when the API asks for a newer version.
 * While the request is pending, or when it fails, the app renders: it must start without the network.
 */
export function VersionGate({ children }: { children: ReactNode }) {
  const { data } = useQuery(getVersionOptions());
  const { checking, applyUpdate } = useServiceWorker();

  if (!isOutdated(data?.minimumAppVersion)) return children;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-bold">Werk de app bij</h1>
      <p className="text-lg">
        Er is een nieuwe versie van PadVinder. Tik op de knop om bij te werken.
      </p>
      <Button
        size="lg"
        className="h-14 w-full text-lg"
        disabled={checking}
        onClick={() => void applyUpdate()}
      >
        {checking ? "Even geduld…" : "Werk de app bij"}
      </Button>
    </main>
  );
}
