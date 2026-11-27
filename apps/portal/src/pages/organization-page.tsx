import {
  administersOrganization,
  apiErrorCode,
  apiErrorIssues,
  useAddOrganizationAdmin,
  useManagedWorkingGroups,
  useMe,
  useOrganization,
  useRemoveOrganizationAdmin,
  useResetOrganizationAdminPasskeys,
  useUpdateOrganization,
} from "@padvinder/api-client";
import type {
  MeResponse,
  OrganizationAdmin,
  OrganizationDetail,
  UpdateOrganizationRequest,
} from "@padvinder/contracts";
import {
  apiErrorMessage,
  Button,
  ConfirmDialog,
  invalidEmailMessage,
  Modal,
  nameInSentence,
  nameOrAddress,
  OrganizationAdminsTable,
  OrganizationForm,
  organizationNameTakenMessage,
  PersonEmailForm,
  showToast,
  type OrganizationFormValues,
} from "@padvinder/ui";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { CreateWorkingGroup } from "./create-working-group";
import { LoadError } from "./load-error";
import { NotFoundPage } from "./not-found-page";
import { useOnSuccess } from "./use-on-success";

/**
 * One organization (`/organizations/{organizationId}`): its contact address, its admins and its
 * working groups. Anyone who does not administer it sees the not-found page without a request; a
 * 404 from the API (also while the page is open) does the same.
 */
export function OrganizationPage() {
  const me = useMe().data;
  const { organizationId = "" } = useParams();
  if (!me || !administersOrganization(me, organizationId)) return <NotFoundPage />;
  return <FindOrganization me={me} organizationId={organizationId} />;
}

function FindOrganization({ me, organizationId }: { me: MeResponse; organizationId: string }) {
  const organization = useOrganization(organizationId);
  if (organization.isPending)
    return (
      <main className="mx-auto max-w-5xl p-4">
        <p className="text-lg">Organisatie laden…</p>
      </main>
    );
  // A failed refetch keeps what it had; only a page that never loaded is an error.
  if (organization.data === undefined)
    return (
      <main className="mx-auto max-w-5xl p-4">
        <LoadError onRetry={() => void organization.refetch()} />
      </main>
    );
  if (organization.data === null) return <NotFoundPage />;
  // A new page per organization, so no dialog or answer of one shows on another.
  return (
    <OrganizationDetails key={organization.data.id} me={me} organization={organization.data} />
  );
}

/** As the server stores a name (`normalizeName` in `@padvinder/db`): trimmed, single spaces. */
const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ");

/** The fields of `values` that differ from what is stored. The server stores addresses in lowercase. */
function changedFields(
  organization: OrganizationDetail,
  values: OrganizationFormValues,
  canRename: boolean,
): UpdateOrganizationRequest {
  const patch: UpdateOrganizationRequest = {};
  if (canRename && normalizeName(values.name) !== organization.name) patch.name = values.name;
  if ((values.contactEmail?.toLowerCase() ?? null) !== organization.contactEmail)
    patch.contactEmail = values.contactEmail;
  return patch;
}

function editErrors(error: unknown): {
  fieldErrors?: { name?: string; contactEmail?: string };
  error?: string;
} {
  if (!error) return {};
  const code = apiErrorCode(error);
  const field = apiErrorIssues(error)[0]?.path;
  if (code === "name_taken") return { fieldErrors: { name: organizationNameTakenMessage } };
  if (code === "invalid_request" && field === "contactEmail")
    return { fieldErrors: { contactEmail: invalidEmailMessage } };
  return { error: apiErrorMessage(code) };
}

function addAdminErrors(error: unknown): { fieldError?: string; error?: string } {
  if (!error) return {};
  const code = apiErrorCode(error);
  if (code === "invalid_request" && apiErrorIssues(error)[0]?.path === "email")
    return { fieldError: invalidEmailMessage };
  return { error: apiErrorMessage(code) };
}

const failureText = (error: unknown) => apiErrorMessage(apiErrorCode(error));

function OrganizationDetails({
  me,
  organization,
}: {
  me: MeResponse;
  organization: OrganizationDetail;
}) {
  const edit = useUpdateOrganization();
  const add = useAddOrganizationAdmin();
  const remove = useRemoveOrganizationAdmin();
  const resetPasskeys = useResetOrganizationAdminPasskeys();
  const [editForm, setEditForm] = useState({ open: false, key: 0 });
  const [addForm, setAddForm] = useState({ open: false, key: 0 });
  const [removing, setRemoving] = useState<{ open: boolean; admin: OrganizationAdmin | null }>({
    open: false,
    admin: null,
  });
  const [resetting, setResetting] = useState<{ open: boolean; admin: OrganizationAdmin | null }>({
    open: false,
    admin: null,
  });
  const [creatingGroup, setCreatingGroup] = useState(false);
  // For showing buttons only: the API decides, and a refusal shows its text.
  const isPlatformAdmin = me.user.isPlatformAdmin;

  function openEdit() {
    edit.reset();
    setEditForm((current) => ({ open: true, key: current.key + 1 }));
  }
  const closeEdit = () => setEditForm((current) => ({ ...current, open: false }));

  function saveEdit(values: OrganizationFormValues) {
    const patch = changedFields(organization, values, isPlatformAdmin);
    // Nothing to save: "is gewijzigd" would not be true, so close without a request or a toast.
    if (Object.keys(patch).length === 0) {
      closeEdit();
      return;
    }
    edit.mutate(
      { organizationId: organization.id, patch },
      {
        onSuccess: (saved) => {
          closeEdit();
          showToast(`Organisatie ${saved.name} is gewijzigd.`);
        },
      },
    );
  }

  function openAdd() {
    add.reset();
    setAddForm((current) => ({ open: true, key: current.key + 1 }));
  }

  function saveAdd(email: string) {
    add.mutate(
      { organizationId: organization.id, email },
      {
        onSuccess: () => {
          setAddForm((current) => ({ ...current, open: false }));
          showToast(`${email} is beheerder van ${organization.name}.`);
        },
      },
    );
  }

  function askRemove(admin: OrganizationAdmin) {
    remove.reset();
    setRemoving({ open: true, admin });
  }

  function confirmRemove() {
    const admin = removing.admin;
    if (!admin) return;
    remove.mutate(
      { organizationId: organization.id, userId: admin.userId },
      {
        onSuccess: () => {
          setRemoving((current) => ({ ...current, open: false }));
          showToast(
            `${nameInSentence(admin.name)} is geen beheerder meer van ${organization.name}.`,
          );
        },
      },
    );
  }

  function askReset(admin: OrganizationAdmin) {
    resetPasskeys.reset();
    setResetting({ open: true, admin });
  }

  function confirmReset() {
    if (resetting.admin)
      resetPasskeys.mutate({ organizationId: organization.id, userId: resetting.admin.userId });
  }

  // On the state, not in `mutate`'s callbacks: after a confirmation the request is sent again.
  useOnSuccess(resetPasskeys.status, () => {
    setResetting((current) => ({ ...current, open: false }));
    if (resetting.admin)
      showToast(`De toegangssleutels van ${nameOrAddress(resetting.admin)} zijn verwijderd.`);
  });
  const cancelReset = () => {
    if (!resetPasskeys.isPending) setResetting((current) => ({ ...current, open: false }));
  };

  // While a save runs, the dialogs stay open: closed, the answer would show nowhere.
  const closeEditUnlessSaving = () => {
    if (!edit.isPending) closeEdit();
  };
  const closeAddUnlessSaving = () => {
    if (!add.isPending) setAddForm((current) => ({ ...current, open: false }));
  };
  const cancelRemove = () => {
    if (!remove.isPending) setRemoving((current) => ({ ...current, open: false }));
  };

  const adminName = removing.admin ? nameInSentence(removing.admin.name) : "";
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{organization.name}</h1>
          <p className="text-lg text-muted-foreground">
            {organization.contactEmail
              ? `Contactadres: ${organization.contactEmail}`
              : "Geen contactadres"}
          </p>
        </div>
        <Button size="lg" variant="outline" onClick={openEdit}>
          Wijzig
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold">Beheerders</h2>
        {isPlatformAdmin ? (
          <Button size="lg" variant="outline" onClick={openAdd}>
            Voeg beheerder toe
          </Button>
        ) : null}
      </div>
      <OrganizationAdminsTable
        admins={organization.admins}
        canRemove={isPlatformAdmin}
        onRemove={askRemove}
        onResetPasskeys={askReset}
      />

      <div className="mt-8 mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold">Werkgroepen</h2>
        <Button size="lg" variant="outline" onClick={() => setCreatingGroup(true)}>
          Nieuwe werkgroep
        </Button>
      </div>
      <OrganizationWorkingGroups organizationId={organization.id} />

      <Modal open={editForm.open} title="Organisatie wijzigen" onClose={closeEditUnlessSaving}>
        <OrganizationForm
          key={editForm.key}
          mode="edit"
          canRename={isPlatformAdmin}
          initial={{ name: organization.name, contactEmail: organization.contactEmail }}
          onSubmit={saveEdit}
          pending={edit.isPending}
          {...editErrors(edit.error)}
        />
      </Modal>
      <Modal open={addForm.open} title="Beheerder toevoegen" onClose={closeAddUnlessSaving}>
        <PersonEmailForm
          key={addForm.key}
          hint="Heeft deze persoon nog geen account? Dan wordt het aangemaakt."
          submitLabel="Voeg toe"
          onSubmit={saveAdd}
          pending={add.isPending}
          {...addAdminErrors(add.error)}
        />
      </Modal>
      <ConfirmDialog
        open={removing.open}
        title={
          removing.admin ? `${adminName} verwijderen als beheerder van ${organization.name}?` : ""
        }
        text={removing.admin ? `${adminName} kan ${organization.name} dan niet meer beheren.` : ""}
        confirmLabel="Verwijder"
        destructive
        pending={remove.isPending}
        error={remove.error ? failureText(remove.error) : undefined}
        onConfirm={confirmRemove}
        onCancel={cancelRemove}
      />
      <ConfirmDialog
        open={resetting.open}
        title={
          resetting.admin
            ? `Toegangssleutels van ${nameOrAddress(resetting.admin)} verwijderen?`
            : ""
        }
        text={
          resetting.admin
            ? `Doe dit als ${nameOrAddress(resetting.admin)} geen toegangssleutel meer heeft, bijvoorbeeld na het kwijtraken van een telefoon. Daarna maakt ${nameOrAddress(resetting.admin)} een nieuwe bij de volgende keer beheren. ${nameOrAddress(resetting.admin)} moet daarna overal opnieuw inloggen.`
            : ""
        }
        confirmLabel="Verwijder"
        destructive
        pending={resetPasskeys.isPending}
        error={resetPasskeys.error ? failureText(resetPasskeys.error) : undefined}
        onConfirm={confirmReset}
        onCancel={cancelReset}
      />
      <CreateWorkingGroup
        open={creatingGroup}
        organizations={[{ id: organization.id, name: organization.name }]}
        onClose={() => setCreatingGroup(false)}
      />
    </main>
  );
}

/** This organization's working groups, from the user's managed groups. */
function OrganizationWorkingGroups({ organizationId }: { organizationId: string }) {
  const workingGroups = useManagedWorkingGroups();
  if (workingGroups.isPending) return <p className="text-lg">Werkgroepen laden…</p>;
  if (!workingGroups.data) return <LoadError onRetry={() => void workingGroups.refetch()} />;
  const groups = workingGroups.data.workingGroups.filter(
    (group) => group.organization.id === organizationId,
  );
  if (groups.length === 0)
    return <p className="text-lg">Deze organisatie heeft nog geen werkgroepen.</p>;
  return (
    <ul className="flex flex-col gap-2 text-lg">
      {groups.map((group) => (
        <li key={group.id}>
          <Link
            to={`/working-groups/${group.id}`}
            className="font-medium underline underline-offset-4"
          >
            {group.name}
          </Link>{" "}
          <span className="text-muted-foreground">{group.city}</span>
        </li>
      ))}
    </ul>
  );
}
