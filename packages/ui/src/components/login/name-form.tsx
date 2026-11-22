import { useState, type SubmitEvent } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { FieldError, Step, WideButton, inputClass, labelClass } from "./form-parts";

export type NameFormProps = {
  onSubmit(values: { name: string; phone: string | null }): void;
  pending: boolean;
  error?: string;
};

export function NameForm({ onSubmit, pending, error }: NameFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [missingName, setMissingName] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setMissingName(true);
      return;
    }
    setMissingName(false);
    const trimmedPhone = phone.trim();
    onSubmit({ name: trimmedName, phone: trimmedPhone === "" ? null : trimmedPhone });
  }

  const nameMessage = missingName ? "Vul je naam in." : undefined;
  return (
    <Step
      title="Hoe heet je?"
      intro="Je naam is te zien voor de mensen in je werkgroep. Je telefoonnummer alleen voor je coördinator."
    >
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
            aria-describedby={error ? "profile-error" : undefined}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={inputClass}
          />
        </div>
        <FieldError id="profile-error" message={error} />
        <WideButton type="submit" pending={pending}>
          Ga verder
        </WideButton>
      </form>
    </Step>
  );
}
