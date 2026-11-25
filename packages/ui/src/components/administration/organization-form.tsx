import { isEmailAddress } from "@padvinder/contracts";
import { useState, type SubmitEvent } from "react";
import { FieldError, WideButton, labelClass } from "../login/form-parts";
import { TextField, invalidEmailMessage, nameProblem } from "./field";

export type OrganizationFormValues = {
  name: string;
  contactEmail: string | null;
  adminEmail: string;
};

export type OrganizationFormProps = {
  mode: "create" | "edit";
  /** Whether the name can be changed; without it the name shows as text. */
  canRename: boolean;
  initial?: { name: string; contactEmail: string | null };
  /** Called with trimmed values; an empty contact address is `null`, and `adminEmail` is `""` when editing. */
  onSubmit(values: OrganizationFormValues): void;
  pending: boolean;
  /** Messages from the server, in Dutch, per field. */
  fieldErrors?: { name?: string; contactEmail?: string; adminEmail?: string };
  /** A message from the server, in Dutch. */
  error?: string;
};

type Problems = { name?: string; contactEmail?: string; adminEmail?: string };

export function OrganizationForm({
  mode,
  canRename,
  initial,
  onSubmit,
  pending,
  fieldErrors,
  error,
}: OrganizationFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [adminEmail, setAdminEmail] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const nameIsEditable = mode === "create" || canRename;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values: OrganizationFormValues = {
      name: nameIsEditable ? name.trim() : (initial?.name ?? ""),
      contactEmail: contactEmail.trim() === "" ? null : contactEmail.trim(),
      adminEmail: mode === "create" ? adminEmail.trim() : "",
    };
    const found: Problems = {
      name: nameIsEditable ? nameProblem(values.name, "naam") : undefined,
      contactEmail:
        values.contactEmail !== null && !isEmailAddress(values.contactEmail)
          ? invalidEmailMessage
          : undefined,
      adminEmail:
        mode === "create" && !isEmailAddress(values.adminEmail) ? invalidEmailMessage : undefined,
    };
    setProblems(found);
    if (found.name || found.contactEmail || found.adminEmail) return;
    onSubmit(values);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 text-lg">
      {nameIsEditable ? (
        <TextField
          id="organization-name"
          name="name"
          label="Naam"
          value={name}
          onChange={setName}
          message={problems.name ?? fieldErrors?.name}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className={`${labelClass} font-medium`}>Naam</p>
          <p>{initial?.name}</p>
        </div>
      )}
      <TextField
        id="organization-contact-email"
        name="contactEmail"
        type="email"
        label="Contactadres"
        hint="Het adres waar leden terechtkunnen als er iets niet klopt. Mag leeg blijven."
        value={contactEmail}
        onChange={setContactEmail}
        message={problems.contactEmail ?? fieldErrors?.contactEmail}
      />
      {mode === "create" ? (
        <TextField
          id="organization-admin-email"
          name="adminEmail"
          type="email"
          label="E-mailadres van de beheerder"
          hint="Heeft deze persoon nog geen account? Dan wordt het aangemaakt."
          value={adminEmail}
          onChange={setAdminEmail}
          message={problems.adminEmail ?? fieldErrors?.adminEmail}
        />
      ) : null}
      <FieldError id="organization-form-error" message={error} />
      <WideButton type="submit" pending={pending}>
        Bewaar
      </WideButton>
    </form>
  );
}
