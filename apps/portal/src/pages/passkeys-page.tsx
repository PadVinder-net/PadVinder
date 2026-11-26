import {
  apiErrorCode,
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
  const create = useCreatePasskey();
  const remove = useRemovePasskey();
  const count = passkeys.data?.passkeys.length;

  // `useCreatePasskey` has no success state: a new passkey shows as a longer list.
  const countAtTap = useRef<number | null>(null);
  useEffect(() => {
    if (countAtTap.current !== null && count !== undefined && count > countAtTap.current) {
      countAtTap.current = null;
      showToast("De toegangssleutel is toegevoegd.");
    }
  }, [count]);
  useEffect(() => {
    if (create.error) countAtTap.current = null;
  }, [create.error]);

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
        onCreate={() => {
          countAtTap.current = count ?? null;
          create.create();
        }}
        removing={remove.isPending}
        removeError={remove.error ? apiErrorMessage(apiErrorCode(remove.error)) : undefined}
        onRemove={(passkey) => remove.mutate(passkey.id)}
        phoneHint
      />
    </main>
  );
}
