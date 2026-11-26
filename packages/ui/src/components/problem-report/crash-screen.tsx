import type { ReactNode } from "react";
import { WideButton } from "../login/form-parts";

export type CrashScreenProps = {
  /** The app speaks of the app, the portal of the page. */
  variant: "app" | "portal";
  onReload(): void;
  /** Opens the problem report form. Only for someone who is logged in; without it, no button. */
  onReport?(): void;
};

const crashTexts = {
  app: "De app liep vast. Laad de app opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
  portal: "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
} as const;

/** What a crash shows, in place of the screen that crashed. */
export function CrashScreen({ variant, onReload, onReport }: CrashScreenProps) {
  return (
    <CrashFrame>
      <h1 className="text-2xl font-semibold">Er ging iets mis</h1>
      <p>{crashTexts[variant]}</p>
      <div className="flex flex-col gap-3">
        <WideButton type="button" onClick={onReload}>
          Laad opnieuw
        </WideButton>
        {onReport ? (
          <WideButton type="button" variant="outline" onClick={onReport}>
            Vertel wat er gebeurde
          </WideButton>
        ) : null}
      </div>
    </CrashFrame>
  );
}

/** The narrow column of the crash screens, on a phone and on a laptop alike. */
export function CrashFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pt-8 text-lg">{children}</main>
  );
}
