import type { ReactNode } from "react";
import { Button } from "../ui/button";

export const pendingLabel = "Even geduld…";

/** Frame of a login step: heading, optional intro text, then the content. */
export function Step({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {intro ? <p>{intro}</p> : null}
      {children}
    </section>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="font-medium text-destructive">
      {message}
    </p>
  );
}

export function WideButton({
  pending,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> & { pending?: boolean }) {
  return (
    <Button size="lg" className="h-14 w-full text-lg" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

export const inputClass = "h-14 text-lg md:text-lg";
export const labelClass = "text-lg";
