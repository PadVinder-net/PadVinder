import { isEmailAddress } from "@padvinder/contracts";
import { useState, type SubmitEvent } from "react";
import { FieldError, WideButton, inputClass, labelClass } from "../login/form-parts";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { TextField, invalidEmailMessage, nameProblem } from "./field";

export type WorkingGroupFormValues = {
  organizationId: string;
  name: string;
  city: string;
  coordinatorEmail: string;
};

export type WorkingGroupFormProps = {
  mode: "create" | "edit";
  organizations: { id: string; name: string }[];
  /** The address of the person who is logged in; the first coordinator starts as them. */
  ownEmail: string;
  initial?: { name: string; city: string };
  /** Called with trimmed values; `coordinatorEmail` is `""` when editing. */
  onSubmit(values: WorkingGroupFormValues): void;
  pending: boolean;
  /** Messages from the server, in Dutch, per field. */
  fieldErrors?: { name?: string; city?: string; coordinatorEmail?: string };
  /** A message from the server, in Dutch. */
  error?: string;
};

type Problems = { name?: string; city?: string; coordinatorEmail?: string };

export function WorkingGroupForm({
  mode,
  organizations,
  ownEmail,
  initial,
  onSubmit,
  pending,
  fieldErrors,
  error,
}: WorkingGroupFormProps) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [coordinatorEmail, setCoordinatorEmail] = useState(ownEmail);
  const [problems, setProblems] = useState<Problems>({});

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values: WorkingGroupFormValues = {
      organizationId,
      name: name.trim(),
      city: city.trim(),
      coordinatorEmail: mode === "create" ? coordinatorEmail.trim() : "",
    };
    const found: Problems = {
      name: nameProblem(values.name, "naam"),
      city: nameProblem(values.city, "plaats"),
      coordinatorEmail:
        mode === "create" && !isEmailAddress(values.coordinatorEmail)
          ? invalidEmailMessage
          : undefined,
    };
    setProblems(found);
    if (found.name || found.city || found.coordinatorEmail) return;
    onSubmit(values);
  }

  const chosenOrganization = organizations.find(
    (organization) => organization.id === organizationId,
  );
  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 text-lg">
      {mode === "create" ? (
        organizations.length > 1 ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="working-group-organization" className={labelClass}>
              Organisatie
            </Label>
            <Select value={organizationId} onValueChange={setOrganizationId}>
              <SelectTrigger id="working-group-organization" className={inputClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className={`${labelClass} font-medium`}>Organisatie</p>
            <p>{chosenOrganization?.name}</p>
          </div>
        )
      ) : null}
      <TextField
        id="working-group-name"
        name="name"
        label="Naam"
        value={name}
        onChange={setName}
        message={problems.name ?? fieldErrors?.name}
      />
      <TextField
        id="working-group-city"
        name="city"
        label="Plaats"
        value={city}
        onChange={setCity}
        message={problems.city ?? fieldErrors?.city}
      />
      {mode === "create" ? (
        <TextField
          id="working-group-coordinator-email"
          name="coordinatorEmail"
          type="email"
          label="E-mailadres van de coördinator"
          hint="Deze persoon wordt de eerste coördinator. Je kunt je eigen adres laten staan."
          value={coordinatorEmail}
          onChange={setCoordinatorEmail}
          message={problems.coordinatorEmail ?? fieldErrors?.coordinatorEmail}
        />
      ) : null}
      <FieldError id="working-group-form-error" message={error} />
      <WideButton type="submit" pending={pending}>
        Bewaar
      </WideButton>
    </form>
  );
}
