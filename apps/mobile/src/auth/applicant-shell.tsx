import {
  apiErrorCode,
  listWorkingGroupsOptions,
  useLogOut,
  useWithdrawMembershipRequest,
  type GetMeResponse,
} from "@padvinder/api-client";
import {
  apiErrorMessage,
  Button,
  connectionMessage,
  logOutFailedMessage,
  WaitingForApproval,
  WorkingGroupPicker,
} from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useJoinWorkingGroup } from "../lib/use-join-working-group";
import { ProfileEditor } from "../screens/more/profile-screen";

const screen = "flex h-dvh flex-col gap-4 p-6";
const linkButton = "h-12 flex-1 text-lg";

/**
 * What a logged-in person without a working group sees: the picker, the waiting screen, and the
 * profile. Shown by the gate; when `me` changes (approved, removed) the gate swaps it for the app.
 */
export function ApplicantShell({ me }: { me: GetMeResponse }) {
  const [showProfile, setShowProfile] = useState(false);
  const { logOut, failed: logOutFailed } = useLogOut();

  if (showProfile) return <ProfileScreen me={me} onBack={() => setShowProfile(false)} />;

  const request = me.membershipRequest;
  const footer = (
    <>
      {logOutFailed ? (
        <p role="alert" className="font-medium text-destructive">
          {logOutFailedMessage}
        </p>
      ) : null}
    </>
  );

  if (request?.status === "pending") {
    return (
      <main className={screen}>
        <Waiting
          requestId={request.id}
          workingGroupName={request.workingGroup.name}
          onLogOut={() => void logOut()}
          onOpenProfile={() => setShowProfile(true)}
        />
        {footer}
      </main>
    );
  }
  return (
    <main className={screen}>
      <div className="min-h-0 flex-1">
        <Choose
          rejectedFrom={request?.status === "rejected" ? request.workingGroup.name : undefined}
        />
      </div>
      {footer}
      <div className="flex gap-3">
        <Button variant="outline" className={linkButton} onClick={() => setShowProfile(true)}>
          Profiel
        </Button>
        <Button variant="outline" className={linkButton} onClick={() => void logOut()}>
          Log uit
        </Button>
      </div>
    </main>
  );
}

function Waiting({
  requestId,
  workingGroupName,
  onLogOut,
  onOpenProfile,
}: {
  requestId: string;
  workingGroupName: string;
  onLogOut(): void;
  onOpenProfile(): void;
}) {
  const withdraw = useWithdrawMembershipRequest();
  return (
    <>
      <WaitingForApproval
        workingGroupName={workingGroupName}
        pending={withdraw.isPending}
        onWithdraw={() => withdraw.mutate({ id: requestId })}
        onLogOut={onLogOut}
        onOpenProfile={onOpenProfile}
      />
      {withdraw.isError ? (
        <p role="alert" className="font-medium text-destructive">
          {apiErrorMessage(apiErrorCode(withdraw.error))}
        </p>
      ) : null}
    </>
  );
}

function Choose({ rejectedFrom }: { rejectedFrom?: string }) {
  const groups = useQuery(listWorkingGroupsOptions());
  // The ID is made at the tap and kept for a second tap on the same group.
  const { join, pending, error } = useJoinWorkingGroup({ onGone: () => void groups.refetch() });

  if (groups.isPending) return <p className="text-lg">Werkgroepen laden…</p>;
  if (groups.isError) {
    return (
      <div className="flex flex-col gap-4 text-lg">
        <p>{connectionMessage}</p>
        <Button size="lg" className="h-14 w-full text-lg" onClick={() => void groups.refetch()}>
          Probeer opnieuw
        </Button>
      </div>
    );
  }

  return (
    <WorkingGroupPicker
      workingGroups={groups.data.workingGroups}
      rejectedFrom={rejectedFrom}
      onJoin={join}
      pending={pending}
      error={error}
    />
  );
}

function ProfileScreen({ me, onBack }: { me: GetMeResponse; onBack(): void }) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Button variant="outline" className="h-12 self-start text-lg" onClick={onBack}>
        Terug
      </Button>
      <ProfileEditor me={me} />
    </main>
  );
}
