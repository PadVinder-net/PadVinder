import {
  apiErrorCode,
  apiErrorIssues,
  useCreateOrganization,
  useMe,
  useOrganizations,
} from "@padvinder/api-client";
import {
  apiErrorMessage,
  Button,
  invalidEmailMessage,
  Modal,
  OrganizationForm,
  OrganizationTable,
  organizationNameTakenMessage,
  showToast,
  type OrganizationFormValues,
} from "@padvinder/ui";
import type { MeResponse } from "@padvinder/contracts";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { LoadError } from "./load-error";
import { NotFoundPage } from "./not-found-page";

/**
 * The organizations (`/organizations`): for a platform admin or an admin of more than one
 * organization. An admin of exactly one goes straight to its page; anyone else finds nothing.
 */
export function OrganizationsPage() {
  const me = useMe().data;
  if (!me) return <NotFoundPage />;
  const [onlyOrganization, ...otherOrganizations] = me.organizationAdminOf;
  if (me.user.isPlatformAdmin || otherOrganizations.length > 0) return <Organizations me={me} />;
  if (onlyOrganization) return <Navigate to={`/organizations/${onlyOrganization.id}`} replace />;
  return <NotFoundPage />;
}

type FieldErrors = { name?: string; contactEmail?: string; adminEmail?: string };

/** What a failed save says: under its field when the API names one, else above the button. */
function createErrors(error: unknown): { fieldErrors?: FieldErrors; error?: string } {
  if (!error) return {};
  const code = apiErrorCode(error);
  const field = apiErrorIssues(error)[0]?.path;
  if (code === "name_taken") return { fieldErrors: { name: organizationNameTakenMessage } };
  if (code === "invalid_request" && (field === "adminEmail" || field === "contactEmail"))
    return { fieldErrors: { [field]: invalidEmailMessage } };
  return { error: apiErrorMessage(code) };
}

function Organizations({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const organizations = useOrganizations();
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Organisaties</h1>
        {me.user.isPlatformAdmin ? <NewOrganization /> : null}
      </div>
      {/* A failed refetch keeps the list it had; only a list that never loaded is an error. */}
      {organizations.data ? (
        <OrganizationTable
          organizations={organizations.data.organizations}
          onOpen={(id) => void navigate(`/organizations/${id}`)}
        />
      ) : organizations.isError ? (
        <LoadError onRetry={() => void organizations.refetch()} />
      ) : (
        <p className="text-lg">Organisaties laden…</p>
      )}
    </main>
  );
}

/** "Nieuwe organisatie": the form in a modal. On success the browser goes to the new page. */
function NewOrganization() {
  const navigate = useNavigate();
  const create = useCreateOrganization();
  const [form, setForm] = useState({ open: false, key: 0 });

  function openForm() {
    create.reset();
    setForm((current) => ({ open: true, key: current.key + 1 }));
  }

  function save(values: OrganizationFormValues) {
    create.mutate(
      { name: values.name, adminEmail: values.adminEmail, contactEmail: values.contactEmail },
      {
        onSuccess: (saved) => {
          setForm((current) => ({ ...current, open: false }));
          showToast(`Organisatie ${saved.name} is toegevoegd.`);
          void navigate(`/organizations/${saved.id}`);
        },
      },
    );
  }

  // While the save runs, the modal stays open: closed, the answer would show nowhere.
  function close() {
    if (create.isPending) return;
    setForm((current) => ({ ...current, open: false }));
  }

  return (
    <>
      <Button size="lg" onClick={openForm}>
        Nieuwe organisatie
      </Button>
      <Modal open={form.open} title="Nieuwe organisatie" onClose={close}>
        <OrganizationForm
          key={form.key}
          mode="create"
          canRename
          onSubmit={save}
          pending={create.isPending}
          {...createErrors(create.error)}
        />
      </Modal>
    </>
  );
}
