import { apiErrorCode, useMe, useReportProblem } from "@padvinder/api-client";
import { apiErrorMessage, captureCrash, CrashFlow, sentErrorEventId } from "@padvinder/ui";
import * as Sentry from "@sentry/react";
import { useEffect, useState, type ReactNode } from "react";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";

/**
 * The crash screen with its problem report, linked to the crash's event when that was sent. The
 * report button shows only for someone who is logged in. It replaces the layout, toaster and all,
 * so the thanks show on the screen.
 */
function PortalCrash({ eventId, page }: { eventId: string | undefined; page: string }) {
  const me = useMe().data;
  const report = useReportProblem();
  return (
    <CrashFlow
      variant="portal"
      contact={me ? { name: me.user.name, email: me.user.email } : null}
      onReload={() => window.location.reload()}
      onSend={async (input) => {
        await report.mutateAsync({
          ...input,
          ...(eventId ? { eventId } : {}),
          page: page.slice(0, 500),
          // The portal has no version of its own: it is identified by its commit.
          appVersion: __GIT_COMMIT__,
          app: "portal",
        });
      }}
      errorText={report.isError ? apiErrorMessage(apiErrorCode(report.error)) : undefined}
    />
  );
}

/**
 * The router's error element. React Router catches a crash in a page before Sentry's
 * ErrorBoundary would, so it is reported here, once: after the commit, since React renders a
 * crashed tree again before it gives up, with a new error each time.
 */
export function RouteCrash() {
  const error = useRouteError();
  const page = useLocation().pathname;
  const [eventId, setEventId] = useState<string>();
  useEffect(() => {
    if (!isRouteErrorResponse(error)) setEventId(captureCrash(error));
  }, [error]);
  return <PortalCrash eventId={eventId} page={page} />;
}

/** Around the whole portal, for a crash outside the router: the gate, the login screens. */
export function RootCrashBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ eventId }) => (
        <PortalCrash eventId={sentErrorEventId(eventId)} page={window.location.pathname} />
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
