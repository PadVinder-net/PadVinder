import type { AddMemberOutcome } from "@padvinder/contracts";
import { addMemberOutcomeMessage } from "../../lib/messages";
import { WideButton } from "../login/form-parts";

export type AddMembersResultsProps = {
  /** In the order of the answer. */
  results: { email: string; outcome: AddMemberOutcome }[];
  onClose(): void;
};

export function AddMembersResults({ results, onClose }: AddMembersResultsProps) {
  return (
    <div className="flex flex-col gap-4 text-lg">
      <ul className="flex flex-col gap-2">
        {results.map((result, index) => (
          <li key={index}>{addMemberOutcomeMessage(result)}</li>
        ))}
      </ul>
      <WideButton type="button" onClick={onClose}>
        Sluit
      </WideButton>
    </div>
  );
}
