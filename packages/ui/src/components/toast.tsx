import { toast } from "sonner";
import { Toaster as SonnerToaster } from "./ui/sonner";

/** Render once per app; `showToast` shows its messages. */
export function Toaster() {
  return <SonnerToaster position="bottom-right" toastOptions={{ style: { fontSize: "1rem" } }} />;
}

/** A short message in Dutch that disappears by itself. */
export function showToast(message: string): void {
  toast(message);
}
