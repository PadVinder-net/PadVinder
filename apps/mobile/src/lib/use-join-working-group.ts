import { apiErrorCode, useCreateMembershipRequest } from "@padvinder/api-client";
import { apiErrorMessage, connectionMessage } from "@padvinder/ui";
import { useState } from "react";
import { newId } from "./new-id";

const goneMessage = "Deze werkgroep bestaat niet meer. Kies een andere werkgroep.";

/** The ID and time of one join attempt, kept until the user picks another group. */
type JoinAttempt = { id: string; workingGroupId: string; requestedAt: string };

/**
 * Asking to join a working group, for the applicant's picker and for a member's Profiel. The ID
 * and time are made when the user taps and kept for a second tap on the same group (AGENTS.md,
 * "Data integrity"); another group gets a new one. `onGone` runs when the group no longer exists,
 * so the screen reloads its list. `error` is the Dutch text of the last failure.
 */
export function useJoinWorkingGroup({ onGone, onSuccess }: { onGone(): void; onSuccess?(): void }) {
  const create = useCreateMembershipRequest();
  const [attempt, setAttempt] = useState<JoinAttempt | null>(null);

  function join(workingGroupId: string) {
    const current =
      attempt?.workingGroupId === workingGroupId
        ? attempt
        : { id: newId(), workingGroupId, requestedAt: new Date().toISOString() };
    setAttempt(current);
    create.mutate(current, {
      onSuccess: () => onSuccess?.(),
      onError: (error) => {
        if (apiErrorCode(error) === "not_found") {
          setAttempt(null);
          onGone();
        }
      },
    });
  }

  const code = create.isError ? apiErrorCode(create.error) : null;
  const error = create.isError
    ? code === "not_found"
      ? goneMessage
      : code === null
        ? connectionMessage
        : apiErrorMessage(code)
    : undefined;
  return { join, pending: create.isPending, error };
}
