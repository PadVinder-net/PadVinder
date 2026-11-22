import type { MembershipRequestForReview } from "@padvinder/contracts";
import { useState } from "react";
import { formatDate } from "../../lib/format";
import { displayName, nameInSentence } from "../../lib/display-name";
import { ConfirmDialog } from "../confirm-dialog";
import { ContactRows, DetailRow } from "../contact-rows";
import { FieldError, WideButton } from "../login/form-parts";

export type MembershipRequestDetailProps = {
  request: MembershipRequestForReview;
  onApprove(): void;
  onReject(): void;
  pending: boolean;
  /** A message from the server, in Dutch. */
  error?: string;
};

export function MembershipRequestDetail({
  request,
  onApprove,
  onReject,
  pending,
  error,
}: MembershipRequestDetailProps) {
  const [asking, setAsking] = useState(false);
  const name = displayName(request.applicant.name);
  return (
    <section className="flex flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">{name}</h2>
      <dl className="flex flex-col gap-3">
        <ContactRows email={request.applicant.email} phone={request.applicant.phone} />
        <DetailRow label="Werkgroep">{request.workingGroup.name}</DetailRow>
      </dl>
      <p>Aangemeld op {formatDate(request.requestedAt)}</p>
      {request.status === "pending" ? (
        <>
          <FieldError id="request-error" message={asking ? undefined : error} />
          <WideButton type="button" pending={pending} onClick={onApprove}>
            Keur goed
          </WideButton>
          <WideButton
            type="button"
            variant="outline"
            pending={pending}
            onClick={() => setAsking(true)}
          >
            Wijs af
          </WideButton>
          <ConfirmDialog
            open={asking}
            title="Aanmelding afwijzen?"
            text={`${nameInSentence(request.applicant.name)} krijgt hierover een mail.`}
            confirmLabel="Wijs af"
            destructive
            pending={pending}
            error={error}
            onConfirm={onReject}
            onCancel={() => setAsking(false)}
          />
        </>
      ) : (
        <p>Deze aanmelding is al behandeld.</p>
      )}
    </section>
  );
}
