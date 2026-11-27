import { useAdminConfirmationExpiry, usePasskeyConfirmation } from "@padvinder/api-client";
import { PasskeyModal } from "@padvinder/ui";

/**
 * The one confirmation modal of the app: it opens when a request the person asked for needs a
 * passkey (`passkey_required`). `AuthGate` mounts it once, while someone is logged in.
 */
export function PasskeyConfirmationHost() {
  const confirmation = usePasskeyConfirmation();
  // When the confirmation runs out, me is refetched, so the screens fall back without a reload.
  useAdminConfirmationExpiry();
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
