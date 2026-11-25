import {
  accountDeletionBlockers,
  apiErrorCode,
  useDeleteAccount,
  useMe,
  useUpdateMe,
  type GetMeResponse,
} from "@padvinder/api-client";
import {
  accountDeletionBlockedMessage,
  apiErrorMessage,
  connectionMessage,
  ProfileForm,
} from "@padvinder/ui";
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
export function ProfileEditor({ me }: { me: GetMeResponse }) {
  const updateMe = useUpdateMe();
  const deleteAccount = useDeleteAccount();
  const error = deleteAccount.isError
    ? deleteAccountMessage(deleteAccount.error)
    : updateMe.isError
      ? connectionMessage
      : undefined;
  return (
    <ProfileForm
      me={me}
      saving={updateMe.isPending}
      saved={updateMe.isSuccess}
      deleting={deleteAccount.isPending}
      error={error}
      onSave={({ name, phone }) => updateMe.mutate({ name, phone })}
      onDelete={() => deleteAccount.mutate()}
    />
  );
}

export function ProfileScreen() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <SubScreen back="/more">
      <ProfileEditor me={me} />
    </SubScreen>
  );
}
