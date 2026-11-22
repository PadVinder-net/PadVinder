import {
  gateState,
  logInWithCode,
  meLoadFailed,
  loginErrorMessage,
  requestLoginCode,
  useMe,
  useUpdateMe,
  type LoginResult,
} from "@padvinder/api-client";
import { Button, LoginFlow, NameForm } from "@padvinder/ui";
import type { ReactNode } from "react";
import { mailAppUrl, openMailApp } from "../hooks/open-mail-app";

const connectionMessage = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

function toMessage(result: LoginResult) {
  return result.ok ? result : { ok: false as const, message: loginErrorMessage(result.error) };
}

const fullScreen = "flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center";

/** Shows the login screen, the name step or the app, depending on who is logged in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const updateMe = useUpdateMe();

  if (me.isPending) {
    return (
      <main className={fullScreen}>
        <p className="text-lg">PadVinder laden…</p>
      </main>
    );
  }
  if (meLoadFailed(me)) {
    return (
      <main className={fullScreen}>
        <p className="text-lg">{connectionMessage}</p>
        <Button size="lg" className="h-14 w-full text-lg" onClick={() => void me.refetch()}>
          Probeer opnieuw
        </Button>
      </main>
    );
  }

  switch (gateState(me.data ?? null)) {
    case "login":
      return (
        <LoginFlow
          requestLoginCode={async (email) => toMessage(await requestLoginCode(email))}
          logInWithCode={async (email, code) => toMessage(await logInWithCode(email, code))}
          onLoggedIn={() => void me.refetch()}
          onOpenMail={mailAppUrl(navigator.userAgent) === null ? undefined : openMailApp}
        />
      );
    case "name":
      return (
        <NameForm
          pending={updateMe.isPending}
          error={updateMe.isError ? connectionMessage : undefined}
          onSubmit={({ name, phone }) => updateMe.mutate({ name, phone })}
        />
      );
    case "app":
      return children;
  }
}
