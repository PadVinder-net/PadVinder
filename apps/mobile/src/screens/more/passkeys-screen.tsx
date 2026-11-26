import {
  apiErrorCode,
  hasAdminRole,
  useCreatePasskey,
  useMe,
  usePasskeys,
  useRemovePasskey,
} from "@padvinder/api-client";
import { apiErrorMessage, PasskeysPanel } from "@padvinder/ui";
import { useState } from "react";
import { SubScreen } from "./sub-screen";

/**
 * The admin's own passkeys (`/more/profile/passkeys`). Someone without an admin role gets the
 * API's "no", as on the other screens a URL typed by hand reaches. A list that needs a
 * confirmation opens the shared modal; after Annuleer the panel shows its load error. Results show
 * inline: the app has no toasts.
 */
export function PasskeysScreen() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <SubScreen back="/more/profile">
      {hasAdminRole(me) ? (
        <Passkeys hasPasskey={me.user.hasPasskey} />
      ) : (
        <p className="text-lg">{apiErrorMessage("not_allowed")}</p>
      )}
    </SubScreen>
  );
}

const addedNotice = "De toegangssleutel is toegevoegd.";

function Passkeys({ hasPasskey }: { hasPasskey: boolean }) {
  const passkeys = usePasskeys();
  const remove = useRemovePasskey();
  const [notice, setNotice] = useState<string>();
  // A first passkey made in the confirmation modal reaches this screen only as `hasPasskey`
  // turning true.
  const [wasPasskey, setWasPasskey] = useState(hasPasskey);
  if (hasPasskey !== wasPasskey) {
    setWasPasskey(hasPasskey);
    if (hasPasskey) setNotice(addedNotice);
  }
  const create = useCreatePasskey({ onCreated: () => setNotice(addedNotice) });
  // The removal's state, not a callback of `mutate`: a removal sent again after a confirmation
  // only shows its success in the state.
  const shown = remove.isSuccess ? "De toegangssleutel is verwijderd." : notice;
  return (
    <>
      {shown ? (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-lg font-medium">
          {shown}
        </p>
      ) : null}
      <PasskeysPanel
        passkeys={passkeys.data?.passkeys}
        loading={passkeys.isPending}
        loadFailed={passkeys.isError && passkeys.data === undefined}
        onRetry={() => void passkeys.refetch()}
        creating={create.pending}
        createError={create.error}
        onCreate={() => {
          setNotice(undefined);
          remove.reset();
          create.create();
        }}
        removing={remove.isPending}
        removeError={remove.error ? apiErrorMessage(apiErrorCode(remove.error)) : undefined}
        onRemove={(passkey) => {
          setNotice(undefined);
          remove.mutate(passkey.id);
        }}
        phoneHint={false}
      />
    </>
  );
}
