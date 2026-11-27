import { apiErrorCode, apiErrorIssues, useCreateWorkingGroup, useMe } from "@padvinder/api-client";
import {
  apiErrorMessage,
  invalidEmailMessage,
  Modal,
  personOutsideOrganizationMessage,
  showToast,
  WorkingGroupForm,
  workingGroupNameTakenMessage,
  type WorkingGroupFormValues,
} from "@padvinder/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useOnSuccess } from "./use-on-success";

export type CreateWorkingGroupProps = {
  open: boolean;
  /** The organizations the group can be made in: all of them for a platform admin, else the admin's own. */
  organizations: { id: string; name: string }[];
  onClose(): void;
};

type FieldErrors = { name?: string; city?: string; coordinatorEmail?: string };

/** What a failed save says: a taken name or a refused address under its field, anything else above the button. */
function formErrors(
  error: unknown,
  organizationName: string,
): { fieldErrors?: FieldErrors; error?: string } {
  if (!error) return {};
  const code = apiErrorCode(error);
  const field = apiErrorIssues(error)[0]?.path;
  if (code === "name_taken") return { fieldErrors: { name: workingGroupNameTakenMessage } };
  if (code === "person_outside_organization")
    return {
      fieldErrors: { coordinatorEmail: personOutsideOrganizationMessage(organizationName) },
    };
  if (code === "invalid_request" && field === "coordinatorEmail")
    return { fieldErrors: { coordinatorEmail: invalidEmailMessage } };
  return { error: apiErrorMessage(code) };
}

/**
 * "Nieuwe werkgroep": the form in a modal. On success the modal closes, a toast says so and the
 * browser goes to the new group's page. A failure keeps the modal open with its text.
 */
export function CreateWorkingGroup({ open, organizations, onClose }: CreateWorkingGroupProps) {
  const me = useMe().data;
  const navigate = useNavigate();
  const create = useCreateWorkingGroup();
  // A new form per opening, so it starts empty every time.
  const [key, setKey] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setKey((current) => current + 1);
  }

  function save(values: WorkingGroupFormValues) {
    const { organizationId, ...body } = values;
    create.mutate({ organizationId, body });
  }
  // On the state, not in `mutate`'s callbacks: after a confirmation the request is sent again.
  useOnSuccess(create.status, () => {
    if (!create.data) return;
    onClose();
    showToast(`Werkgroep ${create.data.name} is toegevoegd.`);
    void navigate(`/working-groups/${create.data.id}`);
  });

  // While the save runs, the modal stays open: closed, the answer would show nowhere.
  function close() {
    if (create.isPending) return;
    // The next opening starts without this one's error.
    create.reset();
    onClose();
  }

  const chosen = organizations.find(
    (organization) => organization.id === create.variables?.organizationId,
  );
  return (
    <Modal open={open} title="Nieuwe werkgroep" onClose={close}>
      <WorkingGroupForm
        key={key}
        mode="create"
        organizations={organizations}
        ownEmail={me?.user.email ?? ""}
        onSubmit={save}
        pending={create.isPending}
        {...formErrors(create.error, chosen?.name ?? "")}
      />
    </Modal>
  );
}
