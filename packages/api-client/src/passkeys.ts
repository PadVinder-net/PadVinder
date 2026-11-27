import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PasskeyError } from "@padvinder/contracts";
import {
  removePasskey,
  resetOrganizationAdminPasskeys,
  resetPlatformAdminPasskeys,
} from "./generated";
import {
  listPasskeysOptions,
  listPasskeysQueryKey,
  listPlatformAdminsQueryKey,
} from "./generated/@tanstack/react-query.gen";
import { refetchMe } from "./me-query";
import { createPasskey } from "./passkey-client";
import { requestPasskeyConfirmation } from "./passkey-confirmation";
import { reopenServerEvents } from "./server-events";

/** The logged-in admin's own passkeys, oldest first. */
export function usePasskeys() {
  return useQuery(listPasskeysOptions());
}

/**
 * After removing or resetting passkeys, also after an error: the own list, the organization pages
 * and the platform admins (which say who has a passkey), and me (`hasPasskey`).
 */
function useSettledPasskeys() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listPasskeysQueryKey() }),
      queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] as { _id?: string } | undefined)?._id === "getOrganization",
      }),
      queryClient.invalidateQueries({ queryKey: listPlatformAdminsQueryKey() }),
      refetchMe(queryClient),
    ]);
  };
}

/** Removes one of the own passkeys. */
export function useRemovePasskey() {
  const onSettled = useSettledPasskeys();
  return useMutation({
    mutationFn: async (passkeyId: string) => {
      await removePasskey({ path: { passkeyId }, throwOnError: true });
    },
    onSettled,
  });
}

/** Removes every passkey of an admin of the organization, for someone who lost their device. */
export function useResetOrganizationAdminPasskeys() {
  const onSettled = useSettledPasskeys();
  return useMutation({
    mutationFn: async (path: { organizationId: string; userId: string }) => {
      await resetOrganizationAdminPasskeys({ path, throwOnError: true });
    },
    onSettled,
  });
}

/** Removes every passkey of a platform admin (platform admins). */
export function useResetPlatformAdminPasskeys() {
  const onSettled = useSettledPasskeys();
  return useMutation({
    mutationFn: async (userId: string) => {
      await resetPlatformAdminPasskeys({ path: { userId }, throwOnError: true });
    },
    onSettled,
  });
}

/**
 * Adds a passkey from the passkeys screen; `create` belongs right in a tap, as browsers open the
 * passkey prompt only then. A further passkey needs a recent confirmation: on
 * `confirmation_required` this opens the confirmation instead of showing an error, and after it the
 * person taps again. On success me and the list are refetched, and the event stream reopens: the
 * server replaced the session. `onCreated` is called once after a success (a creation is never
 * sent again, so a callback is safe).
 */
export function useCreatePasskey(options: { onCreated?: () => void } = {}): {
  create(): void;
  pending: boolean;
  error: PasskeyError | null;
} {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PasskeyError | null>(null);
  // A ref, not state: a second tap before the next render must see the first.
  const running = useRef(false);

  function create() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    void createPasskey().then((result) => {
      running.current = false;
      setPending(false);
      if (result.ok) {
        options.onCreated?.();
        void refetchMe(queryClient);
        reopenServerEvents();
        void queryClient.invalidateQueries({ queryKey: listPasskeysQueryKey() });
      } else if (result.error === "confirmation_required") {
        requestPasskeyConfirmation(queryClient);
      } else {
        setError(result.error);
      }
    });
  }

  return { create, pending, error };
}
