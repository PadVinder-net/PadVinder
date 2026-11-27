import type { LoginResult } from "@padvinder/contracts";
import { useRef, useState } from "react";
import { connectionMessage, loginErrorMessage } from "../../lib/messages";
import { CodeForm } from "./code-form";
import { EmailForm } from "./email-form";

export type { LoginResult };

export type LoginFlowProps = {
  requestLoginCode(email: string): Promise<LoginResult>;
  logInWithCode(email: string, code: string): Promise<LoginResult>;
  onLoggedIn(): void;
  onOpenMail?: () => void;
  /** A message above the email step, for example after the account was deleted. */
  notice?: string;
};

export function LoginFlow({
  requestLoginCode,
  logInWithCode,
  onLoggedIn,
  onOpenMail,
  notice,
}: LoginFlowProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [resent, setResent] = useState(false);
  // State updates are asynchronous, so a double tap needs a ref to be seen.
  const busy = useRef(false);

  async function run(action: () => Promise<LoginResult>, onOk: () => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await action();
      if (result.ok) onOk();
      else setError(loginErrorMessage(result.error));
    } catch {
      setError(connectionMessage);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (email === null) {
    return (
      <EmailForm
        pending={pending}
        error={error}
        notice={notice}
        onSubmit={(address) =>
          void run(
            () => requestLoginCode(address),
            () => {
              setEmail(address);
              setResent(false);
            },
          )
        }
      />
    );
  }
  return (
    <CodeForm
      email={email}
      pending={pending}
      error={error}
      resent={resent}
      onOpenMail={onOpenMail}
      onSubmit={(code) => void run(() => logInWithCode(email, code), onLoggedIn)}
      onResend={() =>
        void run(
          () => requestLoginCode(email),
          () => setResent(true),
        )
      }
      onChangeEmail={() => {
        setEmail(null);
        setError(undefined);
        setResent(false);
      }}
    />
  );
}
