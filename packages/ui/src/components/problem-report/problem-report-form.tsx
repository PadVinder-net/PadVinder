import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { FieldError, WideButton, labelClass } from "../login/form-parts";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";

/** What the form sends; the app adds the page, its version and a crash's event ID. */
export type ProblemReportInput = { message: string; includeContact: boolean };

export type ProblemReportFormProps = {
  /** The user's name and address, from the profile; shown under the checkbox. */
  name: string;
  email: string;
  /** Sends the report. A rejection keeps the form as it is; `errorText` then says why. */
  onSubmit(input: ProblemReportInput): Promise<void>;
  /** Why the last send failed, in Dutch. */
  errorText?: string;
  /** False in a modal, which shows the title itself. */
  heading?: boolean;
  /** Moves focus to the heading when the form appears in place of what had focus. */
  focusHeading?: boolean;
  /** For stories: the form as it looks while sending, or filled in. */
  sending?: boolean;
  initialMessage?: string;
  initialIncludeContact?: boolean;
};

/** The longest message the API takes. */
const maxMessageLength = 2000;

export const problemReportTitle = "Meld een probleem";
/** Shown when a report was sent: as a toast in the portal, on the screen in the app. */
export const problemReportSentMessage = "Bedankt, je melding is verstuurd.";

/**
 * "Meld een probleem": a message to the makers of PadVinder. The name and address go along only
 * when the user ticks the box, which starts unticked every time the form opens.
 */
export function ProblemReportForm({
  name,
  email,
  onSubmit,
  errorText,
  heading = true,
  focusHeading = false,
  sending = false,
  initialMessage = "",
  initialIncludeContact = false,
}: ProblemReportFormProps) {
  const [message, setMessage] = useState(initialMessage);
  const [includeContact, setIncludeContact] = useState(initialIncludeContact);
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);
  const busy = sending || submitting;
  const empty = message.trim() === "";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || empty) return;
    setSubmitting(true);
    try {
      await onSubmit({ message: message.trim(), includeContact });
    } catch {
      // The caller shows why, in `errorText`; the message stays for another try.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 text-lg">
      {heading ? (
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
          {problemReportTitle}
        </h2>
      ) : null}
      <p>
        Werkt er iets niet? Schrijf op wat je deed en wat er misging. Dit gaat naar de makers van
        PadVinder. Wil je een antwoord? Stuur dan je naam en e-mailadres mee.
      </p>
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="problem-report-message" className={labelClass}>
            Wat ging er mis?
          </Label>
          <textarea
            id="problem-report-message"
            name="message"
            rows={6}
            maxLength={maxMessageLength}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? "problem-report-error" : undefined}
            className="w-full aria-invalid:border-destructive rounded-md border border-input bg-transparent px-3 py-2 text-lg shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="problem-report-include-contact"
            checked={includeContact}
            onCheckedChange={(checked) => setIncludeContact(checked === true)}
            aria-describedby="problem-report-contact"
            className="mt-1 size-6"
          />
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="problem-report-include-contact"
              className={`${labelClass} leading-snug`}
            >
              Stuur mijn naam en e-mailadres mee, zodat we je kunnen mailen
            </Label>
            <p id="problem-report-contact" className="flex flex-col text-muted-foreground">
              {name.trim() === "" ? null : <span>{name}</span>}
              <span className="break-all">{email}</span>
            </p>
          </div>
        </div>
        <FieldError id="problem-report-error" message={errorText} />
        <WideButton type="submit" pending={busy} disabled={busy || empty}>
          Verstuur
        </WideButton>
      </form>
    </section>
  );
}
