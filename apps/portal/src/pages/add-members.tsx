import { apiErrorCode, relationToWorkingGroup, useAddMembers } from "@padvinder/api-client";
import type { ManagedWorkingGroup, MeResponse } from "@padvinder/contracts";
import { AddMembersForm, AddMembersResults, apiErrorMessage, Button, Modal } from "@padvinder/ui";
import { useState } from "react";

/** For showing the button only: the API decides. */
export function mayAddMembers(me: MeResponse, group: ManagedWorkingGroup): boolean {
  return (
    relationToWorkingGroup(me, group) !== "outsider" &&
    relationToWorkingGroup(me, group) !== "volunteer"
  );
}

/** "Voeg mensen toe": the button, and its modal with the form and then the results. */
export function AddMembers({ group }: { group: ManagedWorkingGroup }) {
  const add = useAddMembers();
  // A new key for each opening, so the form starts empty; while it stays open it keeps its text.
  const [dialog, setDialog] = useState({ open: false, key: 0 });

  function open() {
    add.reset();
    setDialog((current) => ({ open: true, key: current.key + 1 }));
  }
  // While the request runs the dialog stays open, so its answer shows and nobody sends twice.
  function close() {
    if (add.isPending) return;
    setDialog((current) => ({ ...current, open: false }));
    add.reset();
  }

  return (
    <>
      <Button size="lg" onClick={open}>
        Voeg mensen toe
      </Button>
      <Modal open={dialog.open} title="Mensen toevoegen" onClose={close}>
        {add.data ? (
          <AddMembersResults results={add.data.results} onClose={close} />
        ) : (
          <AddMembersForm
            key={dialog.key}
            pending={add.isPending}
            error={add.error ? apiErrorMessage(apiErrorCode(add.error)) : undefined}
            onSubmit={(emails) => add.mutate({ workingGroupId: group.id, emails })}
          />
        )}
      </Modal>
    </>
  );
}
