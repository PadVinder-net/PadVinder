import {
  logInWithCode,
  requestLoginCode,
  useAccessLiveUpdates,
  useAuthGate,
  useMe,
} from "@padvinder/api-client";
import { AuthGateView } from "@padvinder/ui";
import type { ReactNode } from "react";
import { ApplicantShell } from "./applicant-shell";
import { mailAppUrl, openMailApp } from "../hooks/open-mail-app";

/** Keeps `me` and the requests current for as long as someone is logged in. */
function AccessLiveUpdates() {
  useAccessLiveUpdates();
  return null;
}

/**
 * Shows the login screen, the name step, the applicant screens or the app, depending on who is
 * logged in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const gate = useAuthGate();
  const me = useMe();
  return (
    <>
      {me.data ? <AccessLiveUpdates /> : null}
      <AuthGateView
        state={gate.state}
        onRetry={gate.retry}
        login={{
          requestLoginCode,
          logInWithCode,
          onLoggedIn: gate.onLoggedIn,
          onOpenMail: mailAppUrl(navigator.userAgent) === null ? undefined : openMailApp,
        }}
        saveName={gate.saveName}
        applicant={me.data ? <ApplicantShell me={me.data} /> : null}
      >
        {children}
      </AuthGateView>
    </>
  );
}
