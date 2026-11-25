import { MAX_ADDRESSES_PER_REQUEST } from "@padvinder/contracts";
import { useState, type SubmitEvent } from "react";
import { parseEmailLines } from "../../lib/email-lines";
import { apiErrorMessage } from "../../lib/messages";
import { FieldError, WideButton, labelClass } from "../login/form-parts";
import { Label } from "../ui/label";
import { Hint } from "./field";

export type AddMembersFormProps = {
  /** Called with the right addresses, as typed and trimmed. */
  onSubmit(emails: string[]): void;
  pending: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
  /** The text the field starts with (for stories). */
  initialText?: string;
};

export function AddMembersForm({
  onSubmit,
  pending,
  error,
  initialText = "",
}: AddMembersFormProps) {
  const [text, setText] = useState(initialText);
  const { emails, errors } = parseEmailLines(text);
  // The API counts an address once, whatever its capitals.
  const different = new Set(emails.map((email) => email.toLowerCase())).size;
  const tooMany = different > MAX_ADDRESSES_PER_REQUEST;
  const blocked = errors.length > 0 || tooMany || emails.length === 0;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    onSubmit(emails);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 text-lg">
      <div className="flex flex-col gap-2">
        <Label htmlFor="add-members-emails" className={labelClass}>
          E-mailadressen
        </Label>
        <textarea
          id="add-members-emails"
          name="emails"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={errors.length > 0 || tooMany ? true : undefined}
          aria-describedby="add-members-emails-hint"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-lg shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <Hint id="add-members-emails-hint">Eén adres per regel. Iedereen krijgt een mail.</Hint>
        {errors.map((wrong) => (
          <FieldError
            key={wrong.line}
            id={`add-members-line-${wrong.line}`}
            message={`Regel ${wrong.line}: '${wrong.text}' is geen geldig e-mailadres.`}
          />
        ))}
        <FieldError
          id="add-members-too-many"
          message={tooMany ? apiErrorMessage("too_many_addresses") : undefined}
        />
      </div>
      <FieldError id="add-members-error" message={error} />
      <WideButton type="submit" pending={pending} disabled={pending || blocked}>
        Voeg toe
      </WideButton>
    </form>
  );
}
