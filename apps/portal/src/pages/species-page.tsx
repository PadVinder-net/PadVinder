import {
  apiErrorCode,
  apiErrorIssues,
  useCreateSpecies,
  useSpecies,
  useUpdateSpecies,
} from "@padvinder/api-client";
import type { Species, UpdateSpeciesRequest } from "@padvinder/contracts";
import {
  apiErrorMessage,
  Button,
  capitalizeFirst,
  ConfirmDialog,
  connectionMessage,
  Modal,
  showToast,
  SpeciesForm,
  SpeciesTable,
  speciesNameTakenMessage,
  type SpeciesFormValues,
} from "@padvinder/ui";
import { useState } from "react";
import { useOnSuccess } from "./use-on-success";

type FormState = {
  open: boolean;
  /** A new key per opening, so the form starts from `species` (or empty) every time. */
  key: number;
  /** The species being changed; null for a new one. */
  species: Species | null;
};

type TurnOffState = { open: boolean; species: Species | null };

/** What a failed save says, per field for a taken name, otherwise above the button. */
function formErrors(error: unknown): {
  fieldErrors?: { dutchName?: string; scientificName?: string };
  error?: string;
} {
  if (!error) return {};
  const code = apiErrorCode(error);
  const field = apiErrorIssues(error)[0]?.path;
  if (code === "name_taken" && (field === "dutchName" || field === "scientificName"))
    return { fieldErrors: { [field]: speciesNameTakenMessage(field) } };
  return { error: apiErrorMessage(code) };
}

const nameOf = (species: Species) => capitalizeFirst(species.dutchName);

/** As the server stores a name (`normalizeSpeciesName` in `@padvinder/db`): trimmed, single spaces. */
const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ");

/** The fields of `values` that differ from `species`, as the server would store them. */
function changedFields(species: Species, values: SpeciesFormValues): UpdateSpeciesRequest {
  const patch: UpdateSpeciesRequest = {};
  if (normalizeName(values.dutchName) !== species.dutchName) patch.dutchName = values.dutchName;
  if (normalizeName(values.scientificName) !== species.scientificName)
    patch.scientificName = values.scientificName;
  if (values.needsVerification !== species.needsVerification)
    patch.needsVerification = values.needsVerification;
  return patch;
}

/**
 * The official species list, for platform admins (`RequirePlatformAdmin`): add, rename, and switch
 * off or on. A species is never deleted.
 */
export function SpeciesPage() {
  const species = useSpecies();
  const create = useCreateSpecies();
  const edit = useUpdateSpecies();
  // A switch on has no dialog; its toast comes from the mutation's success, so a request sent
  // again after a passkey confirmation says it too.
  const setActive = useUpdateSpecies({
    onSuccess: (saved, variables) => {
      if (variables.patch.active === true) showToast(`${nameOf(saved)} staat aan.`);
    },
  });
  const [form, setForm] = useState<FormState>({ open: false, key: 0, species: null });
  const [turnOff, setTurnOff] = useState<TurnOffState>({ open: false, species: null });

  function openForm(item: Species | null) {
    create.reset();
    edit.reset();
    setForm((current) => ({ open: true, key: current.key + 1, species: item }));
  }
  const closeForm = () => setForm((current) => ({ ...current, open: false }));

  function save(values: SpeciesFormValues) {
    if (form.species) {
      const patch = changedFields(form.species, values);
      // Nothing to save: "is gewijzigd" would not be true, so close without a request or a toast.
      if (Object.keys(patch).length === 0) {
        closeForm();
        return;
      }
      edit.mutate({ speciesId: form.species.id, patch });
    } else {
      create.mutate(values);
    }
  }
  // On the state, not in `mutate`'s callbacks: after a confirmation the request is sent again.
  useOnSuccess(edit.status, () => {
    if (!edit.data) return;
    closeForm();
    showToast(`${nameOf(edit.data)} is gewijzigd.`);
  });
  useOnSuccess(create.status, () => {
    if (!create.data) return;
    closeForm();
    showToast(`${nameOf(create.data)} is toegevoegd.`);
  });

  function switchOn(item: Species) {
    // Not `mutate`'s callbacks: those fire only for the latest call, and each tap gets its toast.
    void setActive
      .mutateAsync({ speciesId: item.id, patch: { active: true } })
      .catch((error: unknown) => showToast(apiErrorMessage(apiErrorCode(error))));
  }

  function askTurnOff(item: Species) {
    setActive.reset();
    setTurnOff({ open: true, species: item });
  }

  function confirmTurnOff() {
    if (!turnOff.species) return;
    setActive.mutate({ speciesId: turnOff.species.id, patch: { active: false } });
  }
  // Only the switching off has a dialog to close; a switch on shows its toast above.
  useOnSuccess(setActive.status, () => {
    if (!setActive.data || setActive.variables?.patch.active !== false) return;
    setTurnOff((current) => ({ ...current, open: false }));
    showToast(`${nameOf(setActive.data)} staat uit.`);
  });

  function handleSetActive(id: string, active: boolean) {
    const item = species.data?.species.find((candidate) => candidate.id === id);
    if (!item) return;
    if (active) switchOn(item);
    else askTurnOff(item);
  }

  const saving = form.species ? edit : create;
  // While a save runs, the dialogs stay open: closed, the answer would show nowhere, and reopening
  // would reset the mutation and allow a second save.
  const closeFormUnlessSaving = () => {
    if (!saving.isPending) closeForm();
  };
  const cancelTurnOff = () => {
    if (!setActive.isPending) setTurnOff((current) => ({ ...current, open: false }));
  };
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Soorten</h1>
        {species.isSuccess ? (
          <Button size="lg" onClick={() => openForm(null)}>
            Nieuwe soort
          </Button>
        ) : null}
      </div>
      {species.isPending ? (
        <p className="text-lg">Soorten laden…</p>
      ) : species.isError ? (
        <div className="flex flex-col items-start gap-4 text-lg">
          <p role="alert">{connectionMessage}</p>
          <Button size="lg" onClick={() => void species.refetch()}>
            Probeer opnieuw
          </Button>
        </div>
      ) : (
        <SpeciesTable
          species={species.data.species}
          onEdit={(id) => {
            const item = species.data.species.find((candidate) => candidate.id === id);
            if (item) openForm(item);
          }}
          onSetActive={handleSetActive}
        />
      )}
      <Modal
        open={form.open}
        title={form.species ? "Soort wijzigen" : "Nieuwe soort"}
        onClose={closeFormUnlessSaving}
      >
        <SpeciesForm
          key={form.key}
          mode={form.species ? "edit" : "create"}
          initial={
            form.species
              ? {
                  dutchName: form.species.dutchName,
                  scientificName: form.species.scientificName,
                  needsVerification: form.species.needsVerification,
                }
              : undefined
          }
          onSubmit={save}
          pending={saving.isPending}
          {...formErrors(saving.error)}
        />
      </Modal>
      <ConfirmDialog
        open={turnOff.open}
        title={turnOff.species ? `${nameOf(turnOff.species)} uitzetten?` : ""}
        text="Vrijwilligers kunnen deze soort dan niet meer kiezen. Eerdere tellingen blijven bewaard."
        confirmLabel="Zet uit"
        pending={setActive.isPending}
        error={setActive.error ? apiErrorMessage(apiErrorCode(setActive.error)) : undefined}
        onConfirm={confirmTurnOff}
        onCancel={cancelTurnOff}
      />
    </main>
  );
}
