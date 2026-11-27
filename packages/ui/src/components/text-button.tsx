import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export type TextButtonProps = Omit<ComponentProps<"button">, "type"> & {
  /** `button` unless it submits a form. */
  type?: "button" | "submit";
};

/**
 * A button that reads as text: medium weight, in the primary color, without a frame or underline. For a
 * secondary action next to a step's main button, such as "Log uit" or "Ander e-mailadres". It
 * does something; to go to another page or address, use a link (`<a>` or React Router's `Link`),
 * which keeps its underline. The tap target is at least 44 by 44 pixels.
 */
export function TextButton({ type = "button", className, ...props }: TextButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-3 text-lg font-medium whitespace-nowrap text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
