import { useState, type SubmitEvent } from "react";
import { FieldError, WideButton, inputClass, labelClass } from "../login/form-parts";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export type SpeciesFormValues = {
  dutchName: string;
  scientificName: string;
  needsVerification: boolean;
};

export type SpeciesFormProps = {
  mode: "create" | "edit";
  initial?: SpeciesFormValues;
  /** Called with trimmed values. */
  onSubmit(values: SpeciesFormValues): void;
  pending: boolean;
  /** Messages from the server, in Dutch, per field. */
  fieldErrors?: { dutchName?: string; scientificName?: string };
  /** A message from the server, in Dutch. */
  error?: string;
};

const maxNameLength = 100;

/** The problem with a trimmed name, in Dutch, or undefined. */
function nameProblem(name: string): string | undefined {
  if (name === "") return "Vul een naam in.";
  if (name.length > maxNameLength) return "Een naam mag hoogstens honderd tekens hebben.";
  if (name.includes("@")) return "Een naam mag geen @ bevatten.";
  return undefined;
}

export function SpeciesForm({
  mode,
  initial,
  onSubmit,
  pending,
  fieldErrors,
  error,
}: SpeciesFormProps) {
  const [dutchName, setDutchName] = useState(initial?.dutchName ?? "");
  const [scientificName, setScientificName] = useState(initial?.scientificName ?? "");
  const [needsVerification, setNeedsVerification] = useState(initial?.needsVerification ?? false);
  const [problems, setProblems] = useState<{ dutchName?: string; scientificName?: string }>({});

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = {
      dutchName: dutchName.trim(),
      scientificName: scientificName.trim(),
      needsVerification,
    };
    const found = {
      dutchName: nameProblem(values.dutchName),
      scientificName: nameProblem(values.scientificName),
    };
    setProblems(found);
    if (found.dutchName || found.scientificName) return;
    onSubmit(values);
  }

  const dutchMessage = problems.dutchName ?? fieldErrors?.dutchName;
  const scientificMessage = problems.scientificName ?? fieldErrors?.scientificName;
  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 text-lg">
      <p>
        {mode === "create"
          ? 'Schrijf de naam zoals in een zin, bijvoorbeeld "gewone pad".'
          : "Wijzig een naam alleen om een fout te herstellen. Voeg voor een andere soort een nieuwe soort toe."}
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="species-dutch-name" className={labelClass}>
          Nederlandse naam
        </Label>
        <Input
          id="species-dutch-name"
          name="dutchName"
          type="text"
          value={dutchName}
          onChange={(event) => setDutchName(event.target.value)}
          aria-invalid={dutchMessage ? true : undefined}
          aria-describedby={dutchMessage ? "species-dutch-name-error" : undefined}
          className={inputClass}
        />
        <FieldError id="species-dutch-name-error" message={dutchMessage} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="species-scientific-name" className={labelClass}>
          Wetenschappelijke naam
        </Label>
        <Input
          id="species-scientific-name"
          name="scientificName"
          type="text"
          value={scientificName}
          onChange={(event) => setScientificName(event.target.value)}
          aria-invalid={scientificMessage ? true : undefined}
          aria-describedby={scientificMessage ? "species-scientific-name-error" : undefined}
          className={inputClass}
        />
        <FieldError id="species-scientific-name-error" message={scientificMessage} />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="species-needs-verification"
          checked={needsVerification}
          onCheckedChange={(checked) => setNeedsVerification(checked === true)}
          aria-describedby="species-needs-verification-hint"
          className="mt-1 size-6"
        />
        <div className="flex flex-col">
          <Label htmlFor="species-needs-verification" className={labelClass}>
            Betrouwbaarheidscheck nodig
          </Label>
          <p id="species-needs-verification-hint" className="text-muted-foreground">
            Voor zeldzame of beschermde soorten.
          </p>
        </div>
      </div>
      <FieldError id="species-form-error" message={error} />
      <WideButton type="submit" pending={pending}>
        Bewaar
      </WideButton>
    </form>
  );
}
