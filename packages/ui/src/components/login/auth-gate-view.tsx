import type { ReactNode } from "react";
import { connectionMessage } from "../../lib/messages";
import { Button } from "../ui/button";
import { LoginFlow, type LoginFlowProps } from "./login-flow";
import { NameForm, type NameFormProps } from "./name-form";

export type AuthGateViewProps = {
  /** As `useAuthGate` in `@padvinder/api-client` computes it. */
  state: "loading" | "failed" | "login" | "name" | "choose" | "waiting" | "app";
  onRetry(): void;
  login: LoginFlowProps;
  saveName: {
    pending: boolean;
    failed: boolean;
    submit: NameFormProps["onSubmit"];
  };
  /**
   * What an applicant sees (`choose` or `waiting`: no membership and no admin role yet), such as
   * the mobile app's working group picker. Without it, applicants see the app.
   */
  applicant?: ReactNode;
  /** The app, shown once the user is logged in and has a name. */
  children: ReactNode;
};

const statusScreen =
  "mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 p-6 text-center";
const formScreen = "mx-auto w-full max-w-md p-6";

/**
 * The login gate of the mobile app and the portal: loading, a retry screen, the login steps, the
 * name step, the applicant's screens, or the app. Narrow on a wide screen, the full width of a
 * phone.
 */
export function AuthGateView({
  state,
  onRetry,
  login,
  saveName,
  applicant,
  children,
}: AuthGateViewProps) {
  switch (state) {
    case "loading":
      return (
        <main className={statusScreen}>
          <p className="text-lg">PadVinder laden…</p>
        </main>
      );
    case "failed":
      return (
        <main className={statusScreen}>
          <p className="text-lg">{connectionMessage}</p>
          <Button size="lg" className="h-14 w-full text-lg" onClick={onRetry}>
            Probeer opnieuw
          </Button>
        </main>
      );
    case "login":
      return (
        <main className={formScreen}>
          <LoginFlow {...login} />
        </main>
      );
    case "name":
      return (
        <main className={formScreen}>
          <NameForm
            pending={saveName.pending}
            error={saveName.failed ? connectionMessage : undefined}
            onSubmit={saveName.submit}
          />
        </main>
      );
    case "choose":
    case "waiting":
      return applicant ?? children;
    case "app":
      return children;
  }
}
