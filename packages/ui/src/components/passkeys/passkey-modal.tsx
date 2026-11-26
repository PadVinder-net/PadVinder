import type { PasskeyError } from "@padvinder/contracts";
import { passkeyErrorMessage } from "../../lib/messages";
import { FieldError, WideButton } from "../login/form-parts";
import { Button } from "../ui/button";
import { Modal } from "../modal";

export type PasskeyModalProps = {
  open: boolean;
  /** Whether the person has a passkey: confirm with it, or make the first one. */
  hasPasskey: boolean;
  pending: boolean;
  error: PasskeyError | null;
  onConfirm(): void;
  onCancel(): void;
  onLogInAgain(): void;
};

/**
 * Asks an admin to confirm with a passkey, or to make the first one. The main button starts the
 * browser's prompt: browsers open it only right after a tap. While a ceremony runs, the modal
 * cannot be closed.
 */
export function PasskeyModal({
  open,
  hasPasskey,
  pending,
  error,
  onConfirm,
  onCancel,
  onLogInAgain,
}: PasskeyModalProps) {
  const title = hasPasskey ? "Bevestig dat jij het bent" : "Maak een toegangssleutel";
  const text = hasPasskey
    ? "Voor beheer vraagt PadVinder om je toegangssleutel."
    : "Voor beheer heb je een toegangssleutel nodig. Je telefoon of laptop bewaart hem en vraagt om je vingerafdruk, gezicht of pincode. Je maakt hem één keer.";
  const label = hasPasskey ? "Gebruik je toegangssleutel" : "Maak een toegangssleutel";
  return (
    <Modal open={open} title={title} onClose={pending ? () => {} : onCancel}>
      <div className="flex flex-col gap-4 text-lg">
        <p>{text}</p>
        <FieldError
          id="passkey-modal-error"
          message={error ? passkeyErrorMessage(error) : undefined}
        />
        <div className="flex flex-col gap-2">
          {error === "session_too_old" ? (
            <WideButton type="button" onClick={onLogInAgain}>
              Log opnieuw in
            </WideButton>
          ) : (
            <WideButton type="button" pending={pending} onClick={onConfirm}>
              {label}
            </WideButton>
          )}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-14 w-full text-lg"
            disabled={pending}
            onClick={onCancel}
          >
            Annuleer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
