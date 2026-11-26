import { apiErrorCode, useMe, useReportProblem } from "@padvinder/api-client";
import { apiErrorMessage, captureCrash, CrashFlow, sentErrorEventId } from "@padvinder/ui";
import * as Sentry from "@sentry/react";
import { useEffect, useState, type ReactNode } from "react";
import { isRouteErrorResponse, useHref, useLocation, useRouteError } from "react-router";
import { APP_VERSION } from "../app-version";

/**
 * The crash screen with its problem report, linked to the crash's event when that was sent. The
 * report button shows only for someone who is logged in.
 */
function AppCrash({ eventId, page }: { eventId: string | undefined; page: string }) {
  const me = useMe().data;
  const report = useReportProblem();
  return (
    <CrashFlow
      variant="app"
      contact={me ? { name: me.user.name, email: me.user.email } : null}
      onReload={() => window.location.reload()}
      onSend={async (input) => {
        await report.mutateAsync({
          ...input,
          ...(eventId ? { eventId } : {}),
          page: page.slice(0, 500),
          appVersion: APP_VERSION,
          app: "app",
        });
      }}
      errorText={report.isError ? apiErrorMessage(apiErrorCode(report.error)) : undefined}
    />
  );
}

/**
 * The router's error element. React Router catches a crash in a screen before Sentry's
 * ErrorBoundary would, so it is reported here, once: after the commit, since React renders a
 * crashed tree again before it gives up, with a new error each time. An address without a screen
 * (404) is no crash and is not reported.
 */
export function RouteCrash() {
  const error = useRouteError();
  // The path with the /app/ base, without the query.
  const page = useHref({ pathname: useLocation().pathname });
  const [eventId, setEventId] = useState<string>();
  useEffect(() => {
    if (!isRouteErrorResponse(error)) setEventId(captureCrash(error));
  }, [error]);
  return <AppCrash eventId={eventId} page={page} />;
}

/** Around the whole app, for a crash outside the router: the gate, the login screens. */
export function RootCrashBoundary({ children }: { children: ReactNode }) {
  // Unhandled, as the router's crashes are: the app could not go on.
  return (
    <Sentry.ErrorBoundary handled={false} fallback={RootCrash}>
      {children}
    </Sentry.ErrorBoundary>
  );
}

/**
 * The root boundary's fallback, a component of its own so it keeps its state. Whether the crash's
 * event was sent is decided once, right after it was captured: a later event must not unlink it.
 */
function RootCrash({ eventId }: { eventId: string }) {
  const [sentId] = useState(() => sentErrorEventId(eventId));
  const [page] = useState(() => window.location.pathname);
  return <AppCrash eventId={sentId} page={page} />;
}
