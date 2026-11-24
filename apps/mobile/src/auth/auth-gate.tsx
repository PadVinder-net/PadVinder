import {
  deleteAccountMutationKey,
  logInWithCode,
  requestLoginCode,
  useAccessLiveUpdates,
  useAuthGate,
  useMe,
} from "@padvinder/api-client";
import { AuthGateView } from "@padvinder/ui";
import { useMutationState } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApplicantShell } from "./applicant-shell";
import { mailAppUrl, openMailApp } from "../hooks/open-mail-app";

/** Keeps `me` and the requests current for as long as someone is logged in. */
function AccessLiveUpdates() {
  useAccessLiveUpdates();
  return null;
}

/**
 * True from the moment the account was deleted until someone logs in again. The deletion is seen
 * in the mutation cache (`deleteAccountMutationKey`) and remembered here, because the cache drops
 * the finished mutation after a while. Logging out clears that cache and never counts.
 */
function useAccountDeleted(loggedIn: boolean): boolean {
  const deletions = useMutationState({
    filters: { mutationKey: deleteAccountMutationKey, status: "success" },
  }).length;
  const [seen, setSeen] = useState(deletions);
  const [deleted, setDeleted] = useState(false);
  if (deletions !== seen) {
    setSeen(deletions);
    if (deletions > seen) setDeleted(true);
  }
  if (deleted && loggedIn) setDeleted(false);
  return deleted;
}

/**
 * Shows the login screen, the name step, the applicant screens or the app, depending on who is
 * logged in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const gate = useAuthGate();
  const me = useMe();
  const accountDeleted = useAccountDeleted(Boolean(me.data));
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
          notice: accountDeleted ? "Je account is verwijderd." : undefined,
        }}
        saveName={gate.saveName}
        applicant={me.data ? <ApplicantShell me={me.data} /> : null}
      >
        {children}
      </AuthGateView>
    </>
  );
}
