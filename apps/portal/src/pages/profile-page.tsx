import { connectionMessage, ProfileForm } from "@padvinder/ui";
import { useMe, useUpdateMe } from "@padvinder/api-client";
import { Button } from "@padvinder/ui";
import { Link } from "react-router";
import { hasAdminRole } from "../layout/require-admin-role";

/**
 * The user's own profile (`/profile`): name and phone number, without account deletion (that goes
 * through the app). Admins also get the way to their passkeys.
 */
export function ProfilePage() {
  const me = useMe().data;
  const updateMe = useUpdateMe();
  if (!me) return null;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <ProfileForm
        me={me}
        saving={updateMe.isPending}
        saved={updateMe.isSuccess}
        deleting={false}
        error={updateMe.isError ? connectionMessage : undefined}
        onSave={({ name, phone }) => updateMe.mutate({ name, phone })}
      />
      {hasAdminRole(me) ? (
        <Button asChild size="lg" variant="outline" className="h-14 text-lg">
          <Link to="/profile/passkeys">Toegangssleutels</Link>
        </Button>
      ) : null}
    </main>
  );
}
