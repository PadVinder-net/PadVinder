import { useId, useState } from "react";
import type { WorkingGroupSummary } from "@padvinder/contracts";
import { filterWorkingGroups } from "../../lib/filter-working-groups";
import { cn } from "../../lib/utils";
import { FieldError, WideButton, inputClass, labelClass } from "../login/form-parts";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export type WorkingGroupPickerProps = {
  workingGroups: WorkingGroupSummary[];
  rejectedFrom?: string;
  onJoin(workingGroupId: string): void;
  pending: boolean;
  error?: string;
  /** Start values, for stories and tests. */
  initialQuery?: string;
  initialChosenId?: string;
};

export function WorkingGroupPicker({
  workingGroups,
  rejectedFrom,
  onJoin,
  pending,
  error,
  initialQuery = "",
  initialChosenId,
}: WorkingGroupPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [chosenId, setChosenId] = useState<string | null>(initialChosenId ?? null);
  const name = useId();
  const visible = filterWorkingGroups(workingGroups, query);
  const chosen = visible.find((group) => group.id === chosenId);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">Kies je werkgroep</h2>
      {rejectedFrom ? (
        <p role="status" className="rounded-md border-2 border-foreground p-3 font-medium">
          Je aanmelding bij {rejectedFrom} is niet goedgekeurd. Je kunt een andere werkgroep kiezen.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="working-group-filter" className={labelClass}>
          Zoek op werkgroep, organisatie of plaats
        </Label>
        <Input
          id="working-group-filter"
          type="search"
          autoComplete="off"
          placeholder="Zoek op werkgroep, organisatie of plaats"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            // A chosen row that the new filter hides is no longer chosen.
            if (!filterWorkingGroups(workingGroups, next).some((group) => group.id === chosenId)) {
              setChosenId(null);
            }
          }}
          className={inputClass}
        />
      </div>
      {visible.length === 0 ? (
        <p className="font-medium">Geen werkgroep gevonden.</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Werkgroepen"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        >
          {visible.map((group) => {
            const selected = group.id === chosen?.id;
            return (
              <label
                key={group.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-md border-2 px-3 py-2 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  selected ? "border-foreground bg-muted" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={group.id}
                  checked={selected}
                  onChange={() => setChosenId(group.id)}
                  className="sr-only"
                />
                <span className="flex flex-1 flex-col">
                  <span className={selected ? "font-bold" : "font-medium"}>{group.name}</span>
                  <span className="text-base text-muted-foreground">
                    {group.organization.name} · {group.city}
                  </span>
                </span>
                {selected ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-6 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
      <FieldError id="join-error" message={error} />
      <WideButton
        type="button"
        pending={pending}
        disabled={pending || !chosen}
        onClick={() => chosen && onJoin(chosen.id)}
      >
        Meld je aan
      </WideButton>
    </section>
  );
}
