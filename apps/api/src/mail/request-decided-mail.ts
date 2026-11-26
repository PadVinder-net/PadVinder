import type { MembershipRequestReviewRecord } from "@padvinder/db";
import { buildApprovedMail, buildRejectedMail, type Mailer } from "@padvinder/mail";
import type { FastifyBaseLogger } from "fastify";
import { sendInBackground } from "./send-in-background";

/**
 * Mails the applicant that their request was approved or rejected. Called once for each request
 * that was really decided, after the commit (by the review route and by adding someone whose
 * request was pending); never for the same decision again. Not awaited by the request.
 */
export function sendRequestDecidedMail(
  deps: { mailer: Mailer; log: FastifyBaseLogger; publicOrigin: string },
  request: MembershipRequestReviewRecord,
): void {
  // A deleted account has no address; its pending requests are withdrawn, so this is only a guard.
  if (request.applicant.email === undefined) return;
  const input = {
    to: request.applicant.email,
    recipientName: request.applicant.name,
    workingGroupName: request.workingGroup.name,
    appUrl: `${deps.publicOrigin}/app/`,
  };
  sendInBackground(deps.mailer, deps.log, [
    request.status === "approved" ? buildApprovedMail(input) : buildRejectedMail(input),
  ]);
}
