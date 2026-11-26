import {
  apiErrorCode,
  apiErrorIssues,
  useAddPlatformAdmin,
  useMe,
  usePlatformAdmins,
  useRemovePlatformAdmin,
  useResetPlatformAdminPasskeys,
} from "@padvinder/api-client";
import type { PlatformAdmin } from "@padvinder/contracts";
import {
  apiErrorMessage,
  Button,
  ConfirmDialog,
  invalidEmailMessage,
  lastLoggedInPlatformAdminMessage,
  Modal,
  nameOrAddress,
  PersonEmailForm,
  PlatformAdminsTable,
  showToast,
} from "@padvinder/ui";
import { useState } from "react";
import { LoadError } from "./load-error";
import { useOnSuccess } from "./use-on-success";

type AddState = {
  open: boolean;
  /** A new key per opening, so the field starts empty every time. */
  key: number;
  /** The first step asks for the address, the second shows it once more before appointing. */
  step: "email" | "confirm";
  /** The address as the server stores it: trimmed and in lowercase. */
  email: string;
};

type RemoveState = { open: boolean; admin: PlatformAdmin | null };

/** A 400 on the address: the appointment goes back to the field. */
function rejectsEmail(error: unknown): boolean {
  return apiErrorCode(error) === "invalid_request" && apiErrorIssues(error)[0]?.path === "email";
}

function removeErrorText(error: unknown): string {
  const code = apiErrorCode(error);
  return code === "last_platform_admin" ? lastLoggedInPlatformAdminMessage : apiErrorMessage(code);
}

/**
 * The platform admins (`/platform-admins`, inside `RequirePlatformAdmin`): appoint one by address,
 * after showing the address once more, and take the role away. Who removes themself loses the
 * flag in me, and the page turns into the not-found page.
 */
export function PlatformAdminsPage() {
  const me = useMe().data;
  const admins = usePlatformAdmins();
  const add = useAddPlatformAdmin();
  const remove = useRemovePlatformAdmin();
  const resetPasskeys = useResetPlatformAdminPasskeys();
  const [adding, setAdding] = useState<AddState>({ open: false, key: 0, step: "email", email: "" });
  const [removing, setRemoving] = useState<RemoveState>({ open: false, admin: null });
  const [resetting, setResetting] = useState<RemoveState>({ open: false, admin: null });

  function openAdd() {
    add.reset();
    setAdding((current) => ({ open: true, key: current.key + 1, step: "email", email: "" }));
  }
  // While the appointment runs, the modal stays open: closed, the answer would show nowhere.
  const closeAddUnlessSaving = () => {
    if (!add.isPending) setAdding((current) => ({ ...current, open: false }));
  };

  function goOn(email: string) {
    // Nothing is sent yet: the next step shows the address once more.
    add.reset();
    setAdding((current) => ({ ...current, step: "confirm", email: email.toLowerCase() }));
  }

  function goBack() {
    add.reset();
    setAdding((current) => ({ ...current, step: "email" }));
  }

  function appoint() {
    const email = adding.email;
    add.mutate(email);
  }
  // On the state, not in `mutate`'s callbacks: after a confirmation the request is sent again.
  useOnSuccess(add.status, () => {
    setAdding((current) => ({ ...current, open: false }));
    showToast(`${add.variables ?? ""} is hoofdbeheerder.`);
  });

  function askRemove(admin: PlatformAdmin) {
    remove.reset();
    setRemoving({ open: true, admin });
  }

  function confirmRemove() {
    const admin = removing.admin;
    if (!admin) return;
    if (admin.userId === me?.user.id) {
      // Not the state: removing yourself refetches me first, which unmounts this page, and an
      // effect would then not run. The toast still has to say it happened.
      void remove.mutateAsync(admin.userId).then(
        () => {
          setRemoving((current) => ({ ...current, open: false }));
          showToast("Je bent geen hoofdbeheerder meer.");
        },
        // The dialog shows the text of `remove.error`.
        () => {},
      );
    } else {
      remove.mutate(admin.userId);
    }
  }
  // Someone else's removal closes on the state, so the resend after a confirmation closes it too.
  useOnSuccess(remove.status, () => {
    if (!removing.admin || removing.admin.userId === me?.user.id) return;
    setRemoving((current) => ({ ...current, open: false }));
    showToast(`${nameOrAddress(removing.admin)} is geen hoofdbeheerder meer.`);
  });
  const cancelRemove = () => {
    if (!remove.isPending) setRemoving((current) => ({ ...current, open: false }));
  };

  function askReset(admin: PlatformAdmin) {
    resetPasskeys.reset();
    setResetting({ open: true, admin });
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
  const resetName = resetting.admin ? nameOrAddress(resetting.admin) : "";

  const emailRejected = add.error ? rejectsEmail(add.error) : false;
  const step = adding.step === "confirm" && !emailRejected ? "confirm" : "email";
  const ownRemoval = removing.admin !== null && removing.admin.userId === me?.user.id;
  const removeName = removing.admin ? nameOrAddress(removing.admin) : "";

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Hoofdbeheerders</h1>
        {admins.data !== undefined ? (
          <Button size="lg" onClick={openAdd}>
            Voeg hoofdbeheerder toe
          </Button>
        ) : null}
      </div>
      <p className="mb-4 text-lg text-muted-foreground">
        Een hoofdbeheerder kan alles inzien en wijzigen, in alle organisaties.
      </p>
      {admins.isPending ? (
        <p className="text-lg">Hoofdbeheerders laden…</p>
      ) : admins.data === undefined ? (
        <LoadError onRetry={() => void admins.refetch()} />
      ) : (
        <PlatformAdminsTable
          admins={admins.data.platformAdmins}
          onRemove={askRemove}
          onResetPasskeys={askReset}
          canResetPasskeys={(admin) => admin.userId !== me?.user.id}
        />
      )}
      <Modal open={adding.open} title="Hoofdbeheerder toevoegen" onClose={closeAddUnlessSaving}>
        {/* Kept mounted in the second step, so Terug finds the address still in the field. */}
        <div hidden={step !== "email"}>
          <PersonEmailForm
            key={adding.key}
            hint="Heeft deze persoon nog geen account? Dan wordt het aangemaakt."
            submitLabel="Ga verder"
            onSubmit={goOn}
            pending={false}
            fieldError={emailRejected ? invalidEmailMessage : undefined}
          />
        </div>
        {step === "confirm" ? (
          <div className="flex flex-col gap-4 text-lg">
            <p className="break-words">
              {`Je maakt ${adding.email} hoofdbeheerder. Controleer het adres: wie hiermee inlogt, kan alles inzien en wijzigen.`}
            </p>
            {add.error ? (
              <p role="alert" className="font-medium text-destructive">
                {apiErrorMessage(apiErrorCode(add.error))}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button size="lg" className="h-14 text-lg" disabled={add.isPending} onClick={appoint}>
                {add.isPending ? "Even geduld…" : "Maak hoofdbeheerder"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 text-lg"
                disabled={add.isPending}
                onClick={goBack}
              >
                Terug
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={removing.open}
        title={
          ownRemoval
            ? "Jezelf verwijderen als hoofdbeheerder?"
            : removing.admin
              ? `${removeName} verwijderen als hoofdbeheerder?`
              : ""
        }
        text={
          ownRemoval
            ? "Je kunt PadVinder dan niet meer beheren."
            : removing.admin
              ? `${removeName} kan PadVinder dan niet meer beheren.`
              : ""
        }
        confirmLabel="Verwijder"
        destructive
        pending={remove.isPending}
        error={remove.error ? removeErrorText(remove.error) : undefined}
        onConfirm={confirmRemove}
        onCancel={cancelRemove}
      />
      <ConfirmDialog
        open={resetting.open}
        title={resetting.admin ? `Toegangssleutels van ${resetName} verwijderen?` : ""}
        text={
          resetting.admin
            ? `Doe dit als ${resetName} geen toegangssleutel meer heeft, bijvoorbeeld na het kwijtraken van een telefoon. Daarna maakt ${resetName} een nieuwe bij de volgende keer beheren. ${resetName} moet daarna overal opnieuw inloggen.`
            : ""
        }
        confirmLabel="Verwijder"
        destructive
        pending={resetPasskeys.isPending}
        error={resetPasskeys.error ? apiErrorMessage(apiErrorCode(resetPasskeys.error)) : undefined}
        onConfirm={() => {
          if (resetting.admin) resetPasskeys.mutate(resetting.admin.userId);
        }}
        onCancel={cancelReset}
      />
    </main>
  );
}
