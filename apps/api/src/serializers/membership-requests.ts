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

/** The answer for a reviewer: the request plus the applicant's name, email address and phone. */
export function toMembershipRequestForReview(
  record: MembershipRequestReviewRecord,
): MembershipRequestForReview {
  return {
    ...toMembershipRequest(record),
    applicant: {
      id: record.applicant.id,
      name: record.applicant.name,
      email: record.applicant.email,
      phone: record.applicant.phone,
    },
  };
}
