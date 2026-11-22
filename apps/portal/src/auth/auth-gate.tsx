import {
  gateState,
  logInWithCode,
  loginErrorMessage,
  meLoadFailed,
  requestLoginCode,
  useMe,
  useUpdateMe,
  type LoginResult,
} from "@padvinder/api-client";
import { Button, LoginFlow, NameForm } from "@padvinder/ui";
import type { ReactNode } from "react";

const connectionMessage = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

function toMessage(result: LoginResult) {
  return result.ok ? result : { ok: false as const, message: loginErrorMessage(result.error) };
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 p-6 text-center">
      {children}
    </main>
  );
}

/** Shows the login screen, the name step or the portal, depending on who is logged in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const updateMe = useUpdateMe();

  if (me.isPending) {
    return (
      <Centered>
        <p className="text-lg">PadVinder laden…</p>
      </Centered>
    );
  }
  if (meLoadFailed(me)) {
    return (
      <Centered>
        <p className="text-lg">{connectionMessage}</p>
        <Button size="lg" className="h-14 w-full text-lg" onClick={() => void me.refetch()}>
          Probeer opnieuw
        </Button>
      </Centered>
    );
  }

  switch (gateState(me.data ?? null)) {
    case "login":
      return (
        <div className="mx-auto w-full max-w-sm">
          <LoginFlow
            requestLoginCode={async (email) => toMessage(await requestLoginCode(email))}
            logInWithCode={async (email, code) => toMessage(await logInWithCode(email, code))}
            onLoggedIn={() => void me.refetch()}
          />
        </div>
      );
    case "name":
      return (
        <div className="mx-auto w-full max-w-sm">
          <NameForm
            pending={updateMe.isPending}
            error={updateMe.isError ? connectionMessage : undefined}
            onSubmit={({ name, phone }) => updateMe.mutate({ name, phone })}
          />
        </div>
      );
    case "app":
      return children;
  }
}
