export type PasskeyHiddenProps = {
  onReveal(): void;
  /** The grey bar's length; a short one for a phone number, a long one for an address. */
  width?: "short" | "long";
};

/** A grey bar where a passkey confirmation would show more, with an eye button to ask for it. */
export function PasskeyHidden({ onReveal, width = "long" }: PasskeyHiddenProps) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`block h-5 rounded bg-muted ${width === "short" ? "w-24" : "w-48"}`}
      />
      <button
        type="button"
        aria-label="Toon met je toegangssleutel"
        onClick={onReveal}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </span>
  );
}
