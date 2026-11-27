import { useEffect, useRef, useState } from "react";
import { isCompleteCode, normalizeCode } from "../../lib/code";
import { TextButton } from "../text-button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { FieldError, Step, WideButton, inputClass, labelClass } from "./form-parts";

export type CodeFormProps = {
  email: string;
  onSubmit(code: string): void;
  onResend(): void;
  onChangeEmail(): void;
  /** Leave out where the phone cannot open its mail app. */
  onOpenMail?: () => void;
  pending: boolean;
  error?: string;
  /** True after a new code was sent. */
  resent?: boolean;
};

export function CodeForm({
  email,
  onSubmit,
  onResend,
  onChangeEmail,
  onOpenMail,
  pending,
  error,
  resent = false,
}: CodeFormProps) {
  const [code, setCode] = useState("");
  // The code that was already handed to onSubmit, so a re-render never submits it twice.
  const submittedCode = useRef<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(pending);

  // After every attempt (wrong code, new code sent) the field starts empty again, so the same
  // code can be typed, pasted or autofilled again.
  useEffect(() => {
    if (wasPending.current && !pending) {
      setCode("");
      submittedCode.current = null;
      inputRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending]);

  function handleChange(value: string) {
    const next = normalizeCode(value);
    setCode(next);
    if (!isCompleteCode(next)) {
      submittedCode.current = null;
      return;
    }
    if (submittedCode.current === next) return;
    submittedCode.current = next;
    onSubmit(next);
  }

  return (
    <Step
      title="Vul je code in"
      intro={`We hebben een code gestuurd naar ${email}. De code is een half uur geldig.`}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-code" className={labelClass}>
          Code
        </Label>
        <Input
          id="login-code"
          ref={inputRef}
          readOnly={pending}
          name="code"
          type="text"
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={(event) => handleChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-code-error" : undefined}
          className={`${inputClass} tracking-widest`}
        />
        <FieldError id="login-code-error" message={error} />
        {resent && !error ? <p role="status">We hebben de code opnieuw gestuurd.</p> : null}
      </div>
      {onOpenMail ? (
        <WideButton type="button" onClick={onOpenMail}>
          Open je mail
        </WideButton>
      ) : null}
      <WideButton type="button" variant="outline" pending={pending} onClick={onResend}>
        Stuur opnieuw
      </WideButton>
      <TextButton className="h-14 w-full" onClick={onChangeEmail}>
        Ander e-mailadres
      </TextButton>
    </Step>
  );
}
