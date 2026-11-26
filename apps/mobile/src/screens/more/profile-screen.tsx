import {
  accountDeletionBlockers,
  apiErrorCode,
  useDeleteAccount,
  useMe,
  useUpdateMe,
  useWithdrawMembershipRequest,
  type GetMeResponse,
} from "@padvinder/api-client";
import {
  accountDeletionBlockedMessage,
  apiErrorMessage,
  connectionMessage,
  ProfileForm,
} from "@padvinder/ui";
import { useNavigate } from "react-router";
import { SubScreen } from "./sub-screen";

/**
 * Why the deletion failed. A blocked one (the only coordinator or admin) says, per group and
 * organization, whom to ask, in place of the text for the code.
 */
function deleteAccountMessage(error: unknown): string {
  const blockers = accountDeletionBlockers(error);
  if (blockers.length > 0) return blockers.map(accountDeletionBlockedMessage).join(" ");
  return apiErrorMessage(apiErrorCode(error));
}

/**
 * The profile with saving and deleting the account. Also used by the applicant screens. After a
 * deletion the gate shows the login screen with "Je account is verwijderd.".
 */
export function ProfileEditor({
  me,
  onJoinAnother,
}: {
  me: GetMeResponse;
  /** Only for a member: asking for another working group. Not passed on the applicant's profile. */
  onJoinAnother?(): void;
}) {
  const updateMe = useUpdateMe();
  const withdraw = useWithdrawMembershipRequest();
  const request = me.membershipRequest;
  // A rejected request shows nothing here. The applicant's profile has neither prop.
  const pending = onJoinAnother && request?.status === "pending" ? request : undefined;
  const deleteAccount = useDeleteAccount();
  const error = deleteAccount.isError
    ? deleteAccountMessage(deleteAccount.error)
    : updateMe.isError
      ? connectionMessage
      : withdraw.isError
        ? apiErrorMessage(apiErrorCode(withdraw.error))
        : undefined;
  return (
    <ProfileForm
      me={me}
      saving={updateMe.isPending}
      saved={updateMe.isSuccess}
      deleting={deleteAccount.isPending}
      error={error}
      onSave={({ name, phone }) => {
        withdraw.reset();
        updateMe.mutate({ name, phone });
      }}
      onDelete={() => deleteAccount.mutate()}
      pendingRequest={pending ? { workingGroupName: pending.workingGroup.name } : undefined}
      withdrawing={withdraw.isPending}
      onWithdrawRequest={
        pending
          ? () => {
              // Only the error of the latest action shows.
              updateMe.reset();
              withdraw.mutate({ id: pending.id });
            }
          : undefined
      }
      onJoinAnother={pending ? undefined : onJoinAnother}
    />
  );
}

export function ProfileScreen() {
  const me = useMe().data;
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <SubScreen back="/more">
      <ProfileEditor me={me} onJoinAnother={() => void navigate("/more/profile/join")} />
    </SubScreen>
  );
}
