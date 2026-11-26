import { useEffect, useRef, useState } from "react";
import { WideButton } from "../login/form-parts";
import { CrashFrame, CrashScreen } from "./crash-screen";
import {
  ProblemReportForm,
  problemReportSentMessage,
  type ProblemReportInput,
} from "./problem-report-form";

export type CrashFlowProps = {
  variant: "app" | "portal";
  /** The logged-in user's name and address; null before login, which hides the report button. */
  contact: { name: string; email: string } | null;
  onReload(): void;
  /** Sends the report; a rejection keeps the form, with `errorText`. */
  onSend(input: ProblemReportInput): Promise<void>;
  errorText?: string;
  /** For stories: start at the form or at the thanks. */
  initialStep?: CrashStep;
};

type CrashStep = "crash" | "form" | "sent";

/**
 * The crash screen with its problem report: "Vertel wat er gebeurde" opens the form in place,
 * since the router may be what crashed, and a sent report thanks the user there too.
 */
export function CrashFlow({
  variant,
  contact,
  onReload,
  onSend,
  errorText,
  initialStep = "crash",
}: CrashFlowProps) {
  const [step, setStep] = useState<CrashStep>(initialStep);
  // Each step replaces the button that was pressed, so focus moves along; not on the first render.
  const [moved, setMoved] = useState(false);
  const thanksRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (moved && step === "sent") thanksRef.current?.focus();
  }, [moved, step]);
  const goTo = (next: CrashStep) => {
    setMoved(true);
    setStep(next);
  };
  if (step === "crash" || contact === null) {
    return (
      <CrashScreen
        variant={variant}
        onReload={onReload}
        onReport={contact === null ? undefined : () => goTo("form")}
      />
    );
  }
  const reload = (
    <WideButton type="button" variant={step === "sent" ? "default" : "outline"} onClick={onReload}>
      Laad opnieuw
    </WideButton>
  );
  if (step === "sent") {
    return (
      <CrashFrame>
        <p ref={thanksRef} role="status" tabIndex={-1} className="font-medium outline-none">
          {problemReportSentMessage}
        </p>
        {reload}
      </CrashFrame>
    );
  }
  return (
    <CrashFrame>
      <ProblemReportForm
        name={contact.name}
        email={contact.email}
        errorText={errorText}
        focusHeading={moved}
        onSubmit={async (input) => {
          await onSend(input);
          goTo("sent");
        }}
      />
      {reload}
    </CrashFrame>
  );
}
