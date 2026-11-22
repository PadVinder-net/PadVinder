import type { MembershipRequest, MembershipRequestForReview } from "@padvinder/contracts";
import type { MembershipRequestRecord, MembershipRequestReviewRecord } from "@padvinder/db";

/**
 * The answer for the applicant: every field is picked by name, so `userId`, `receivedAt` and
 * anything a caller's record carries beyond it (an applicant's contact details) stay out.
 */
export function toMembershipRequest(record: MembershipRequestRecord): MembershipRequest {
  return {
    id: record.id,
    status: record.status,
    requestedAt: record.requestedAt.toISOString(),
    decidedAt: record.decidedAt?.toISOString() ?? null,
    workingGroup: record.workingGroup,
  };
}

/**
 * The answer for a reviewer: the request plus the applicant's name, and their email address and
 * phone only while the request is pending ("Who sees names" allows a reviewer the contact details
 * of someone with a pending request; after the decision a member's contact comes only from the
 * members list). A deleted account's record has no contact keys, and neither has the answer.
 */
export function toMembershipRequestForReview(
  record: MembershipRequestReviewRecord,
): MembershipRequestForReview {
  const showContact = record.status === "pending";
  return {
    ...toMembershipRequest(record),
    applicant: {
      id: record.applicant.id,
      name: record.applicant.name,
      ...(showContact && record.applicant.email !== undefined && { email: record.applicant.email }),
      ...(showContact && record.applicant.phone !== undefined && { phone: record.applicant.phone }),
    },
  };
}
