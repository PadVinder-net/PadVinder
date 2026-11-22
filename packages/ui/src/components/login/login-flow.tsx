import { useRef, useState } from "react";
import { CodeForm } from "./code-form";
import { EmailForm } from "./email-form";

export type LoginResult = { ok: true } | { ok: false; message: string };

export type LoginFlowProps = {
  requestLoginCode(email: string): Promise<LoginResult>;
  logInWithCode(email: string, code: string): Promise<LoginResult>;
  onLoggedIn(): void;
  onOpenMail?: () => void;
};

const connectionMessage = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

export function LoginFlow({
  requestLoginCode,
  logInWithCode,
  onLoggedIn,
  onOpenMail,
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
      else setError(result.message);
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
