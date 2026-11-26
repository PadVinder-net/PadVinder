import { useState, type SubmitEvent } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { FieldError, Step, WideButton, inputClass, labelClass } from "./form-parts";

export type EmailFormProps = {
  onSubmit(email: string): void;
  /** Something pends: both buttons are disabled. */
  pending: boolean;
  /** What pends is the passkey login: its button reads "Even geduld…", not "Stuur code". */
  passkeyPending?: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
  /** A message above the form, for example after the account was deleted. */
  notice?: string;
  /** When given, the button "Log in met je toegangssleutel" shows under the form. */
  onPasskey?: () => void;
};

export function EmailForm({
  onSubmit,
  pending,
  passkeyPending = false,
  error,
  notice,
  onPasskey,
}: EmailFormProps) {
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes("@")) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(trimmed);
  }

  const message = invalid ? "Vul een geldig e-mailadres in." : error;
  return (
    <Step title="Log in bij PadVinder" intro="Vul je e-mailadres in. Je krijgt een code per mail.">
      {notice ? <p role="status">{notice}</p> : null}
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-email" className={labelClass}>
            E-mailadres
          </Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "login-email-error" : undefined}
            className={inputClass}
          />
          <FieldError id="login-email-error" message={message} />
        </div>
        <WideButton type="submit" pending={pending && !passkeyPending} disabled={pending}>
          Stuur code
        </WideButton>
      </form>
      {onPasskey ? (
        <WideButton
          type="button"
          variant="outline"
          pending={pending && passkeyPending}
          disabled={pending}
          onClick={onPasskey}
        >
          Log in met je toegangssleutel
        </WideButton>
      ) : null}
    </Step>
  );
}
