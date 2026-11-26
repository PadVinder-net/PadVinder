import type { LoginResult, PasskeyResult } from "@padvinder/contracts";
import { useRef, useState } from "react";
import { connectionMessage, loginErrorMessage, passkeyErrorMessage } from "../../lib/messages";
import { CodeForm } from "./code-form";
import { EmailForm } from "./email-form";

export type { LoginResult };

export type LoginFlowProps = {
  requestLoginCode(email: string): Promise<LoginResult>;
  logInWithCode(email: string, code: string): Promise<LoginResult>;
  onLoggedIn(): void;
  /** When given, the email step offers logging in with a passkey (the portal). */
  logInWithPasskey?: () => Promise<PasskeyResult>;
  onOpenMail?: () => void;
  /** A message above the email step, for example after the account was deleted. */
  notice?: string;
};

async function asMessage(
  result: Promise<LoginResult>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const done = await result;
  return done.ok ? done : { ok: false, message: loginErrorMessage(done.error) };
}

function asPasskeyMessage(done: PasskeyResult): { ok: true } | { ok: false; message: string } {
  return done.ok ? done : { ok: false, message: passkeyErrorMessage(done.error) };
}

export function LoginFlow({
  requestLoginCode,
  logInWithCode,
  onLoggedIn,
  logInWithPasskey,
  onOpenMail,
  notice,
}: LoginFlowProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [error, setError] = useState<string>();
  const [resent, setResent] = useState(false);
  // State updates are asynchronous, so a double tap needs a ref to be seen.
  const busy = useRef(false);

  async function run(
    action: () => Promise<{ ok: true } | { ok: false; message: string }>,
    onOk: () => void,
    { passkey = false }: { passkey?: boolean } = {},
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setPasskeyPending(passkey);
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
      setPasskeyPending(false);
    }
  }

  if (email === null) {
    return (
      <EmailForm
        pending={pending}
        passkeyPending={passkeyPending}
        error={error}
        notice={notice}
        onPasskey={
          logInWithPasskey
            ? () =>
                void run(async () => asPasskeyMessage(await logInWithPasskey()), onLoggedIn, {
                  passkey: true,
                })
            : undefined
        }
        onSubmit={(address) =>
          void run(
            () => asMessage(requestLoginCode(address)),
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
      onSubmit={(code) => void run(() => asMessage(logInWithCode(email, code)), onLoggedIn)}
      onResend={() =>
        void run(
          () => asMessage(requestLoginCode(email)),
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
