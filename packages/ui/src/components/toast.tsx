import { toast } from "sonner";
import { Toaster as SonnerToaster } from "./ui/sonner";

/**
 * Render once per app; `showToast` shows its messages. Sonner names its region "Notifications"
 * unless told otherwise, and a screen reader reads that name aloud.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      containerAriaLabel="Meldingen"
      toastOptions={{ style: { fontSize: "1rem" } }}
    />
  );
}

/** A short message in Dutch that disappears by itself. */
export function showToast(message: string): void {
  toast(message);
}

/**
 * Dismisses every toast. Sonner keeps toasts in a module-wide list and shows them again in the
 * next Toaster that mounts, so tests call this between tests to start clean.
 */
export function dismissAllToasts(): void {
  toast.dismiss();
}
