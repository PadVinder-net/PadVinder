import { logInWithCode, requestLoginCode, useAuthGate } from "@padvinder/api-client";
import { AuthGateView } from "@padvinder/ui";
import type { ReactNode } from "react";

/** Shows the login screen, the name step or the portal, depending on who is logged in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const gate = useAuthGate();
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
