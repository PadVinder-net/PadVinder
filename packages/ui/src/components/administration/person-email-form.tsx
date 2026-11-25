import { isEmailAddress } from "@padvinder/contracts";
import { useState, type SubmitEvent } from "react";
import { FieldError, WideButton } from "../login/form-parts";
import { TextField, invalidEmailMessage } from "./field";

export type PersonEmailFormProps = {
  hint?: string;
  submitLabel: string;
  /** Called with the trimmed address. */
  onSubmit(email: string): void;
  pending: boolean;
  /** A message from the server for the field, in Dutch. */
  fieldError?: string;
  /** A message from the server, in Dutch. */
  error?: string;
};

export function PersonEmailForm({
  hint,
  submitLabel,
  onSubmit,
  pending,
  fieldError,
  error,
}: PersonEmailFormProps) {
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string>();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    const found = isEmailAddress(value) ? undefined : invalidEmailMessage;
    setProblem(found);
    if (found) return;
    onSubmit(value);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 text-lg">
      <TextField
        id="person-email"
        name="email"
        type="email"
        label="E-mailadres"
        hint={hint}
        value={email}
        onChange={setEmail}
        message={problem ?? fieldError}
      />
      <FieldError id="person-email-form-error" message={error} />
      <WideButton type="submit" pending={pending}>
        {submitLabel}
      </WideButton>
    </form>
  );
}
