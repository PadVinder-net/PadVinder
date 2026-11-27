import {
  apiErrorCode,
  useMe,
  useCreatePasskey,
  usePasskeys,
  useRemovePasskey,
} from "@padvinder/api-client";
import { apiErrorMessage, PasskeysPanel, showToast } from "@padvinder/ui";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useOnSuccess } from "./use-on-success";

/**
 * The admin's own passkeys (`/profile/passkeys`, inside `RequireAdminRole`). A list that needs a
 * confirmation opens the shared modal; after Annuleer the panel shows its load error.
 */
export function PasskeysPage() {
  const passkeys = usePasskeys();
  const remove = useRemovePasskey();

  const hasPasskey = useMe().data?.user.hasPasskey ?? false;
  // A first passkey made in the confirmation modal reaches this page only as `hasPasskey` turning
  // true; one made here toasts through `onCreated`, and this flag stops the second toast.
  const toastedHere = useRef(false);
  const create = useCreatePasskey({
    onCreated: () => {
      toastedHere.current = !hasPasskey;
      showToast("De toegangssleutel is toegevoegd.");
    },
  });
  const wasPasskey = useRef(hasPasskey);
  useEffect(() => {
    if (hasPasskey && !wasPasskey.current) {
      if (toastedHere.current) toastedHere.current = false;
      else showToast("De toegangssleutel is toegevoegd.");
    }
    wasPasskey.current = hasPasskey;
  }, [hasPasskey]);

  useOnSuccess(remove.status, () => showToast("De toegangssleutel is verwijderd."));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Link to="/profile" className="text-lg underline underline-offset-4">
        Terug naar Profiel
      </Link>
      <PasskeysPanel
        passkeys={passkeys.data?.passkeys}
        loading={passkeys.isPending}
        loadFailed={passkeys.isError && passkeys.data === undefined}
        onRetry={() => void passkeys.refetch()}
        creating={create.pending}
        createError={create.error}
        onCreate={create.create}
        removing={remove.isPending}
        removeError={remove.error ? apiErrorMessage(apiErrorCode(remove.error)) : undefined}
        onRemove={(passkey) => remove.mutate(passkey.id)}
        phoneHint
        headingLevel={1}
      />
    </main>
  );
}
