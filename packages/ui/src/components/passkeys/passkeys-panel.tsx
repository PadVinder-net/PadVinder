import type { Passkey, PasskeyError } from "@padvinder/contracts";
import { useEffect, useRef, useState } from "react";
import { connectionMessage, passkeyErrorMessage } from "../../lib/messages";
import { formatDate } from "../../lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { FieldError, WideButton } from "../login/form-parts";
import { Button } from "../ui/button";

export type PasskeysPanelProps = {
  passkeys: Passkey[] | undefined;
  loading: boolean;
  loadFailed: boolean;
  onRetry(): void;
  creating: boolean;
  createError: PasskeyError | null;
  onCreate(): void;
  removing: boolean;
  /** A message from the server, in Dutch; shown in the removal dialog. */
  removeError?: string;
  onRemove(passkey: Passkey): void;
  /** Shows the hint that the person can also choose their phone in the browser's window. */
  phoneHint: boolean;
  /** 1 where the panel is the whole page (the portal); the default is 2. */
  headingLevel?: 1 | 2;
};

/** The admin's own passkeys: the list, adding one and removing one. */
export function PasskeysPanel({
  passkeys,
  loading,
  loadFailed,
  onRetry,
  creating,
  createError,
  onCreate,
  removing,
  removeError,
  onRemove,
  phoneHint,
  headingLevel = 2,
}: PasskeysPanelProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const [asking, setAsking] = useState<Passkey | null>(null);
  const wasRemoving = useRef(false);
  // The dialog closes when the removal ends without an error.
  useEffect(() => {
    if (wasRemoving.current && !removing && !removeError) setAsking(null);
    wasRemoving.current = removing;
  }, [removing, removeError]);

  const only = passkeys?.length === 1;
  return (
    <section className="flex flex-col gap-6 text-lg">
      <Heading className="text-2xl font-semibold">Toegangssleutels</Heading>
      <p>
        Met een toegangssleutel bevestig je dat jij het bent als je iets beheert. Je telefoon of
        laptop vraagt dan om je vingerafdruk, gezicht of pincode.
      </p>
      {passkeys ? (
        passkeys.length === 0 ? (
          <p>Je hebt nog geen toegangssleutel.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center justify-between gap-4 rounded-md border p-4"
              >
                <div>
                  <p>Toegevoegd op {formatDate(passkey.createdAt)}</p>
                  {passkey.backedUp ? (
                    <p className="text-muted-foreground">Synchroniseert met je andere apparaten</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-14 text-lg"
                  aria-label={`Verwijder toegangssleutel van ${formatDate(passkey.createdAt)}`}
                  onClick={() => setAsking(passkey)}
                >
                  Verwijder
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : loading ? (
        <p>Toegangssleutels laden…</p>
      ) : loadFailed ? (
        <div className="flex flex-col gap-3">
          <p role="alert">{connectionMessage}</p>
          <WideButton type="button" variant="outline" onClick={onRetry}>
            Probeer opnieuw
          </WideButton>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <WideButton type="button" pending={creating} onClick={onCreate}>
          Voeg een toegangssleutel toe
        </WideButton>
        <FieldError
          id="passkeys-create-error"
          message={createError ? passkeyErrorMessage(createError) : undefined}
        />
        {phoneHint ? (
          <p className="text-muted-foreground">
            Wil je ook op je telefoon beheren? Kies dan in het venster voor je telefoon.
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={asking !== null}
        title="Toegangssleutel verwijderen?"
        text={
          only
            ? "Dit is je laatste toegangssleutel. Daarna maak je een nieuwe de volgende keer dat je iets beheert."
            : "Je kunt hem daarna niet meer gebruiken."
        }
        confirmLabel="Verwijder"
        destructive
        pending={removing}
        error={removeError}
        onConfirm={() => {
          if (asking) onRemove(asking);
        }}
        onCancel={() => {
          if (!removing) setAsking(null);
        }}
      />
    </section>
  );
}
