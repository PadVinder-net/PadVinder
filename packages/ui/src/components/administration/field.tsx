import type { ReactNode } from "react";
import { FieldError, inputClass, labelClass } from "../login/form-parts";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const maxNameLength = 100;

/** The problem with a trimmed name or city, in Dutch, or undefined. `what` is "naam" or "plaats". */
export function nameProblem(value: string, what: "naam" | "plaats"): string | undefined {
  const article = what === "naam" ? "Een naam" : "Een plaats";
  if (value === "") return `Vul een ${what} in.`;
  if (value.length > maxNameLength) return `${article} mag hoogstens honderd tekens hebben.`;
  if (value.includes("@")) return `${article} mag geen @ bevatten.`;
  return undefined;
}

export const invalidEmailMessage = "Vul een geldig e-mailadres in.";

/** A labelled text field with an optional hint and a message under it. */
export function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  message,
  type = "text",
  name,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange(value: string): void;
  message?: string;
  type?: "text" | "email";
  name: string;
}) {
  const describedBy =
    [hint ? `${id}-hint` : undefined, message ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className={labelClass}>
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
      />
      <Hint id={`${id}-hint`}>{hint}</Hint>
      <FieldError id={`${id}-error`} message={message} />
    </div>
  );
}

export function Hint({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-muted-foreground">
      {children}
    </p>
  );
}
