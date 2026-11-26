import {
  authenticateWithPasskey,
  logInWithCode,
  requestLoginCode,
  useAuthGate,
  useMe,
} from "@padvinder/api-client";
import { AuthGateView, useBrowserMonitoringUser } from "@padvinder/ui";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shows the login screen, the name step or the portal, depending on who is logged in.
 *
 * The router lives on behind the login screen, so its address outlasts a session. `onLoggedOut`
 * runs when the login screen replaces someone who was logged in (Log uit, or a session that ended),
 * so the portal can send the address back to `/` and the next person starts at their own first
 * page. Someone who opens a page before logging in keeps that address.
 */
export function AuthGate({
  children,
  onLoggedOut,
}: {
  children: ReactNode;
  onLoggedOut?: () => void;
}) {
  const gate = useAuthGate();
  const me = useMe();
  // Sentry's user: the account's ID while logged in, none after logging out.
  useBrowserMonitoringUser(me.data === undefined ? undefined : (me.data?.user.id ?? null));
  const wasLoggedIn = useRef(false);
  useEffect(() => {
    if (gate.state === "login") {
      if (wasLoggedIn.current) onLoggedOut?.();
      wasLoggedIn.current = false;
    } else if (gate.state !== "loading" && gate.state !== "failed") {
      wasLoggedIn.current = true;
    }
  }, [gate.state, onLoggedOut]);
  return (
    <AuthGateView
      state={gate.state}
      onRetry={gate.retry}
      login={{
        requestLoginCode,
        logInWithCode,
        logInWithPasskey: authenticateWithPasskey,
        onLoggedIn: gate.onLoggedIn,
      }}
      saveName={gate.saveName}
      logOut={gate.logOut}
    >
      {children}
    </AuthGateView>
  );
}
