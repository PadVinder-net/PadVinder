import { useManagedWorkingGroups, useMe, useOrganizations } from "@padvinder/api-client";
import type { MeResponse } from "@padvinder/contracts";
import { Button, WorkingGroupTable } from "@padvinder/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { RequireManagesSomething } from "../layout/require-manages-something";
import { CreateWorkingGroup } from "./create-working-group";
import { LoadError } from "./load-error";

/**
 * The working groups the user manages (`/working-groups`): every group for a platform admin, those
 * of their organizations for an admin, the ones they coordinate for a coordinator. Admins add a
 * group here.
 */
export function WorkingGroupsPage() {
  return (
    <RequireManagesSomething>
      <WorkingGroups />
    </RequireManagesSomething>
  );
}

function WorkingGroups() {
  const me = useMe().data!;
  const navigate = useNavigate();
  const workingGroups = useManagedWorkingGroups();
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Werkgroepen</h1>
        {me.user.isPlatformAdmin ? (
          <NewWorkingGroupForPlatformAdmin />
        ) : me.organizationAdminOf.length > 0 ? (
          <NewWorkingGroup organizations={me.organizationAdminOf} />
        ) : null}
      </div>
      {/* A failed refetch keeps the list it had; only a list that never loaded is an error. */}
      {workingGroups.data ? (
        <WorkingGroupTable
          workingGroups={workingGroups.data.workingGroups}
          onOpen={(id) => void navigate(`/working-groups/${id}`)}
        />
      ) : workingGroups.isError ? (
        <LoadError onRetry={() => void workingGroups.refetch()} />
      ) : (
        <p className="text-lg">Werkgroepen laden…</p>
      )}
    </main>
  );
}

/** A platform admin makes a group in any organization; the list comes from the API. */
function NewWorkingGroupForPlatformAdmin() {
  const organizations = useOrganizations();
  if (!organizations.data) return null;
  return <NewWorkingGroup organizations={organizations.data.organizations} />;
}

function NewWorkingGroup({ organizations }: { organizations: MeResponse["organizationAdminOf"] }) {
  const [open, setOpen] = useState(false);
  if (organizations.length === 0) return null;
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        Nieuwe werkgroep
      </Button>
      <CreateWorkingGroup
        open={open}
        organizations={organizations}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
