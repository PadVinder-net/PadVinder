import { logInWithCode, requestLoginCode, useAuthGate } from "@padvinder/api-client";
import { AuthGateView } from "@padvinder/ui";
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
      login={{ requestLoginCode, logInWithCode, onLoggedIn: gate.onLoggedIn }}
      saveName={gate.saveName}
    >
      {children}
    </AuthGateView>
  );
}
