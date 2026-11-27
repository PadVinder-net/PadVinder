import { useState, type SubmitEvent } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { FieldError, Step, WideButton, inputClass, labelClass } from "./form-parts";

export type EmailFormProps = {
  onSubmit(email: string): void;
  pending: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
  /** A message above the form, for example after the account was deleted. */
  notice?: string;
};

export function EmailForm({ onSubmit, pending, error, notice }: EmailFormProps) {
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
        <WideButton type="submit" pending={pending}>
          Stuur code
        </WideButton>
      </form>
    </Step>
  );
}
