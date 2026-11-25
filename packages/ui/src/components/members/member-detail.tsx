import type { Member } from "@padvinder/contracts";
import { useState } from "react";
import { displayName, nameInSentence } from "../../lib/display-name";
import { ConfirmDialog } from "../confirm-dialog";
import { ContactRows } from "../contact-rows";
import { FieldError, WideButton } from "../login/form-parts";

export type MemberDetailProps = {
  member: Member;
  workingGroupName: string;
  canRemove: boolean;
  onRemove(): void;
  pending: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
};

export function MemberDetail({
  member,
  workingGroupName,
  canRemove,
  onRemove,
  pending,
  error,
}: MemberDetailProps) {
  const [asking, setAsking] = useState(false);
  const name = displayName(member.name, member.hasLoggedIn);
  return (
    <section className="flex flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">{name}</h2>
      {member.email !== undefined ? (
        <dl className="flex flex-col gap-3">
          <ContactRows email={member.email} phone={member.phone} />
        </dl>
      ) : null}
      {canRemove ? (
        <>
          <FieldError id="member-error" message={asking ? undefined : error} />
          <WideButton
            type="button"
            variant="outline"
            pending={pending}
            onClick={() => setAsking(true)}
          >
            Verwijder uit werkgroep
          </WideButton>
          <ConfirmDialog
            open={asking}
            title={`${nameInSentence(member.name)} verwijderen uit ${workingGroupName}?`}
            text={`${nameInSentence(member.name)} kan zich daarna opnieuw aanmelden.`}
            confirmLabel="Verwijder"
            destructive
            pending={pending}
            error={error}
            onConfirm={onRemove}
            onCancel={() => setAsking(false)}
          />
        </>
      ) : null}
    </section>
  );
}
