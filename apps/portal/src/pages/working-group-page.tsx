import {
  apiErrorCode,
  apiErrorIssues,
  listMembersOptions,
  mayManageWorkingGroup,
  mayRemoveMember,
  refetchAdministration,
  useManagedWorkingGroups,
  useMe,
  useRemoveMembership,
  useSetCoordinator,
  useUpdateWorkingGroup,
} from "@padvinder/api-client";
import type {
  ManagedWorkingGroup,
  Member,
  MeResponse,
  UpdateWorkingGroupRequest,
} from "@padvinder/contracts";
import {
  apiErrorMessage,
  Button,
  ConfirmDialog,
  MembersTable,
  Modal,
  nameInSentence,
  showToast,
  WorkingGroupForm,
  workingGroupNameTakenMessage,
  type WorkingGroupFormValues,
} from "@padvinder/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { RequireManagesSomething } from "../layout/require-manages-something";
import { NotFoundPage } from "./not-found-page";
import { LoadError } from "./load-error";

/**
 * One working group (`/working-groups/{workingGroupId}`): its details and its members. It is found
 * in the user's list of managed groups; a group that is not (or no longer) in it is not found.
 */
export function WorkingGroupPage() {
  return (
    <RequireManagesSomething>
      <FindWorkingGroup />
    </RequireManagesSomething>
  );
}

function FindWorkingGroup() {
  const me = useMe().data!;
  const { workingGroupId = "" } = useParams();
  const workingGroups = useManagedWorkingGroups();
  if (workingGroups.isPending)
    return (
      <main className="mx-auto max-w-5xl p-4">
        <p className="text-lg">Werkgroep laden…</p>
      </main>
    );
  // A failed refetch keeps the list it had; only a list that never loaded is an error.
  if (!workingGroups.data)
    return (
      <main className="mx-auto max-w-5xl p-4">
        <LoadError onRetry={() => void workingGroups.refetch()} />
      </main>
    );
  const group = workingGroups.data.workingGroups.find(
    (candidate) => candidate.id === workingGroupId,
  );
  if (!group) return <NotFoundPage />;
  // A new page per group, so no dialog or answer of one group shows on another.
  return <WorkingGroupDetails key={group.id} me={me} group={group} />;
}

/** As the server stores a name or city (`normalizeName` in `@padvinder/db`): trimmed, single spaces. */
const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ");

/** The fields of `values` that differ from `group`, as the server would store them. */
function changedFields(
  group: ManagedWorkingGroup,
  values: WorkingGroupFormValues,
): UpdateWorkingGroupRequest {
  const patch: UpdateWorkingGroupRequest = {};
  if (normalizeName(values.name) !== group.name) patch.name = values.name;
  if (normalizeName(values.city) !== group.city) patch.city = values.city;
  return patch;
}

/** What a failed edit says: a taken name under Naam, anything else above the button. */
function editErrors(error: unknown): { fieldErrors?: { name?: string }; error?: string } {
  if (!error) return {};
  const code = apiErrorCode(error);
  if (code === "name_taken" && (apiErrorIssues(error)[0]?.path ?? "name") === "name")
    return { fieldErrors: { name: workingGroupNameTakenMessage } };
  return { error: apiErrorMessage(code) };
}

const failureText = (error: unknown) => apiErrorMessage(apiErrorCode(error));

function WorkingGroupDetails({ me, group }: { me: MeResponse; group: ManagedWorkingGroup }) {
  const queryClient = useQueryClient();
  const members = useQuery(listMembersOptions({ path: { workingGroupId: group.id } }));
  const edit = useUpdateWorkingGroup();
  const setActive = useUpdateWorkingGroup();
  const setCoordinator = useSetCoordinator();
  const remove = useRemoveMembership();
  const [form, setForm] = useState({ open: false, key: 0 });
  const [askingTurnOff, setAskingTurnOff] = useState(false);
  const [removing, setRemoving] = useState<{ open: boolean; member: Member | null }>({
    open: false,
    member: null,
  });
  // For showing buttons only: the API decides, and a refusal shows its text.
  const manages = mayManageWorkingGroup(me, group);

  function openForm() {
    edit.reset();
    setForm((current) => ({ open: true, key: current.key + 1 }));
  }
  const closeForm = () => setForm((current) => ({ ...current, open: false }));

  function save(values: WorkingGroupFormValues) {
    const patch = changedFields(group, values);
    // Nothing to save: "is gewijzigd" would not be true, so close without a request or a toast.
    if (Object.keys(patch).length === 0) {
      closeForm();
      return;
    }
    edit.mutate(
      { workingGroupId: group.id, patch },
      {
        onSuccess: (saved) => {
          closeForm();
          showToast(`Werkgroep ${saved.name} is gewijzigd.`);
        },
      },
    );
  }

  function switchOn() {
    // Not `mutate`'s callbacks: those fire only for the latest call, and each tap gets its toast.
    void setActive.mutateAsync({ workingGroupId: group.id, patch: { active: true } }).then(
      (saved) => showToast(`Werkgroep ${saved.name} staat aan.`),
      (error: unknown) => showToast(failureText(error)),
    );
  }

  function askTurnOff() {
    setActive.reset();
    setAskingTurnOff(true);
  }

  function confirmTurnOff() {
    setActive.mutate(
      { workingGroupId: group.id, patch: { active: false } },
      {
        onSuccess: (saved) => {
          setAskingTurnOff(false);
          showToast(`Werkgroep ${saved.name} staat uit.`);
        },
      },
    );
  }

  function handleSetCoordinator(member: Member, isCoordinator: boolean) {
    const name = nameInSentence(member.name);
    void setCoordinator.mutateAsync({ membershipId: member.membershipId, isCoordinator }).then(
      () =>
        showToast(
          isCoordinator
            ? `${name} is nu coördinator van ${group.name}.`
            : `${name} is geen coördinator meer van ${group.name}.`,
        ),
      (error: unknown) => showToast(failureText(error)),
    );
  }

  function askRemove(member: Member) {
    remove.reset();
    setRemoving({ open: true, member });
  }

  function confirmRemove() {
    const member = removing.member;
    if (!member) return;
    remove.mutate(
      { membershipId: member.membershipId },
      {
        onSuccess: () => {
          setRemoving((current) => ({ ...current, open: false }));
          showToast(`${nameInSentence(member.name)} is verwijderd uit ${group.name}.`);
        },
        // The list's member count changed too.
        onSettled: () => void refetchAdministration(queryClient),
      },
    );
  }

  // While a save runs, the dialogs stay open: closed, the answer would show nowhere, and reopening
  // would reset the mutation and allow a second save.
  const closeFormUnlessSaving = () => {
    if (!edit.isPending) closeForm();
  };
  const cancelTurnOff = () => {
    if (!setActive.isPending) setAskingTurnOff(false);
  };
  const cancelRemove = () => {
    if (!remove.isPending) setRemoving((current) => ({ ...current, open: false }));
  };

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-lg text-muted-foreground">
            {group.city} · {group.organization.name}
          </p>
          {group.active ? null : <p className="mt-2 text-lg">Deze werkgroep staat uit.</p>}
        </div>
        {manages ? (
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="outline" onClick={openForm}>
              Wijzig
            </Button>
            {group.active ? (
              <Button size="lg" variant="outline" onClick={askTurnOff}>
                Zet uit
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={switchOn}>
                Zet aan
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <h2 className="mb-4 text-xl font-bold">Leden</h2>
      {/* A failed refetch keeps the members it had; only a list that never loaded is an error. */}
      {members.data ? (
        <MembersTable
          members={members.data.members}
          canSetCoordinator={manages}
          canRemove={(member) => mayRemoveMember(me, group, member.isCoordinator)}
          onSetCoordinator={handleSetCoordinator}
          onRemove={askRemove}
        />
      ) : members.isError ? (
        <LoadError onRetry={() => void members.refetch()} />
      ) : (
        <p className="text-lg">Leden laden…</p>
      )}
      <Modal open={form.open} title="Werkgroep wijzigen" onClose={closeFormUnlessSaving}>
        <WorkingGroupForm
          key={form.key}
          mode="edit"
          organizations={[group.organization]}
          ownEmail={me.user.email}
          initial={{ name: group.name, city: group.city }}
          onSubmit={save}
          pending={edit.isPending}
          {...editErrors(edit.error)}
        />
      </Modal>
      <ConfirmDialog
        open={askingTurnOff}
        title={`Werkgroep ${group.name} uitzetten?`}
        text="De leden zien deze werkgroep dan niet meer in de app."
        confirmLabel="Zet uit"
        pending={setActive.isPending}
        error={setActive.error ? failureText(setActive.error) : undefined}
        onConfirm={confirmTurnOff}
        onCancel={cancelTurnOff}
      />
      <ConfirmDialog
        open={removing.open}
        title={
          removing.member
            ? `${nameInSentence(removing.member.name)} verwijderen uit ${group.name}?`
            : ""
        }
        text={
          removing.member
            ? `${nameInSentence(removing.member.name)} kan zich daarna opnieuw aanmelden.`
            : ""
        }
        confirmLabel="Verwijder"
        destructive
        pending={remove.isPending}
        error={remove.error ? failureText(remove.error) : undefined}
        onConfirm={confirmRemove}
        onCancel={cancelRemove}
      />
    </main>
  );
}
