import { usePasskeyConfirmation } from "@padvinder/api-client";
import { PasskeyModal } from "@padvinder/ui";

/**
 * The one confirmation modal of the portal: it opens when a request the person asked for needs a
 * passkey (`passkey_required`), and `PortalLayout` renders it once, next to the `Toaster`.
 */
export function PasskeyConfirmationHost() {
  const confirmation = usePasskeyConfirmation();
  return (
    <PasskeyModal
      open={confirmation.open}
      hasPasskey={confirmation.hasPasskey}
      pending={confirmation.pending}
      error={confirmation.error}
      onConfirm={confirmation.confirm}
      onCancel={confirmation.cancel}
      onLogInAgain={confirmation.logInAgain}
    />
  );
}
