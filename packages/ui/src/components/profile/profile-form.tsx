import type { MeResponse } from "@padvinder/contracts";
import { useState, type SubmitEvent } from "react";
import { ConfirmDialog } from "../confirm-dialog";
import { DetailRow } from "../contact-rows";
import { FieldError, WideButton, inputClass, labelClass } from "../login/form-parts";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export type ProfileFormProps = {
  me: MeResponse;
  onSave(values: { name: string; phone: string | null }): void;
  onDelete(): void;
  saving: boolean;
  /** True after the last save succeeded. */
  saved?: boolean;
  deleting: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
};

export function ProfileForm({
  me,
  onSave,
  onDelete,
  saving,
  saved,
  deleting,
  error,
}: ProfileFormProps) {
  const [name, setName] = useState(me.user.name);
  const [phone, setPhone] = useState(me.user.phone ?? "");
  const [missingName, setMissingName] = useState(false);
  const [asking, setAsking] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setMissingName(true);
      return;
    }
    setMissingName(false);
    const trimmedPhone = phone.trim();
    onSave({ name: trimmedName, phone: trimmedPhone === "" ? null : trimmedPhone });
  }

  const nameMessage = missingName ? "Vul je naam in." : undefined;
  return (
    <section className="flex flex-col gap-6 text-lg">
      <h2 className="text-2xl font-semibold">Profiel</h2>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-name" className={labelClass}>
            Naam
          </Label>
          <Input
            id="profile-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={nameMessage ? true : undefined}
            aria-describedby={nameMessage ? "profile-name-error" : undefined}
            className={inputClass}
          />
          <FieldError id="profile-name-error" message={nameMessage} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profile-phone" className={labelClass}>
            Telefoonnummer (mag leeg)
          </Label>
          <Input
            id="profile-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={30}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={inputClass}
          />
        </div>
        <FieldError id="profile-error" message={error} />
        {saved && !error ? <p role="status">Je gegevens zijn bewaard.</p> : null}
        <WideButton type="submit" pending={saving}>
          Bewaar
        </WideButton>
      </form>
      <dl className="flex flex-col gap-3">
        <DetailRow label="E-mailadres">{me.user.email}</DetailRow>
        <DetailRow label="Je werkgroepen">
          {me.memberships.length === 0 ? (
            "Je bent nog geen lid van een werkgroep."
          ) : (
            <ul>
              {me.memberships.map((membership) => (
                <li key={membership.id}>
                  {membership.workingGroup.name}, {membership.workingGroup.organization.name}
                </li>
              ))}
            </ul>
          )}
        </DetailRow>
      </dl>
      <WideButton
        type="button"
        variant="outline"
        pending={deleting}
        onClick={() => setAsking(true)}
      >
        Verwijder account
      </WideButton>
      <ConfirmDialog
        open={asking}
        title="Account verwijderen?"
        text="Je naam, e-mailadres en telefoonnummer worden gewist. Wat je hebt geteld blijft bewaard, zonder je naam. Dit kun je niet terugdraaien."
        confirmLabel="Verwijder account"
        destructive
        pending={deleting}
        onConfirm={onDelete}
        onCancel={() => setAsking(false)}
      />
    </section>
  );
}
