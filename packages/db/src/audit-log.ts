import type { DbTransaction } from "./client";
import { auditLogEntries } from "./schema";

export type AuditActor = { kind: "user"; userId: string } | { kind: "system" };

export type AuditAction =
  | "organization.created"
  | "organization.updated"
  | "working_group.created"
  | "role.platform_admin_granted"
  | "role.platform_admin_revoked"
  | "role.organization_admin_granted"
  | "role.organization_admin_revoked"
  | "role.coordinator_granted"
  | "role.coordinator_revoked"
  | "membership_request.approved"
  | "membership_request.rejected"
  | "membership.removed"
  | "account.deleted"
  | "species.created"
  | "species.updated"
  | "species.deactivated"
  | "species.activated";

export type AuditSubject = {
  type: "user" | "organization" | "working_group" | "membership" | "membership_request" | "species";
  id: string;
};

/** Which fields changed and non-personal values. Never a name, an email address or a phone number. */
export type AuditDetails = Record<string, string | number | boolean | null>;

export type AuditEntry = {
  actor: AuditActor;
  organizationId: string | null;
  action: AuditAction;
  subject: AuditSubject;
  details?: AuditDetails;
};

/**
 * A details key that contains one of these, in any case, is refused: `fullName`, `emailAddress`
 * and `phoneNumber` as much as `name`. Choose keys without them (`workingGroupId`, `role`). The
 * only exceptions are the exact keys in `THING_NAME_AUDIT_KEYS`.
 */
const PERSONAL_KEY_PARTS = ["name", "mail", "phone"];

/**
 * Exact keys that are allowed although they contain "name": they hold the name of a thing, never of
 * a person (`species.created`, `species.updated`, `organization.updated` and
 * `working_group.updated`). Add a key here only for the name of a thing (a species, an
 * organization, a working group), never for a person. Their values still get the "@" check.
 */
export const THING_NAME_AUDIT_KEYS: readonly string[] = [
  "dutchName",
  "scientificName",
  "dutchNameFrom",
  "dutchNameTo",
  "scientificNameFrom",
  "scientificNameTo",
  "organizationNameFrom",
  "organizationNameTo",
  "workingGroupNameFrom",
  "workingGroupNameTo",
];

function assertNoPersonalData(details: AuditDetails): void {
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (
      (!THING_NAME_AUDIT_KEYS.includes(key) &&
        PERSONAL_KEY_PARTS.some((part) => lowerKey.includes(part))) ||
      (typeof value === "string" && value.includes("@"))
    ) {
      throw new Error(
        `The audit log must not hold personal data: details key "${key}" is not allowed. Use IDs and non-personal values.`,
      );
    }
  }
}

/**
 * Writes one audit entry. It takes the transaction that makes the change, not the database, so an
 * entry exists exactly when the change was committed. Entries are never updated or deleted.
 */
export async function recordAudit(tx: DbTransaction, entry: AuditEntry): Promise<void> {
  const details = entry.details ?? {};
  assertNoPersonalData(details);
  await tx.insert(auditLogEntries).values({
    actorKind: entry.actor.kind,
    actorUserId: entry.actor.kind === "user" ? entry.actor.userId : null,
    organizationId: entry.organizationId,
    action: entry.action,
    subjectType: entry.subject.type,
    subjectId: entry.subject.id,
    details,
  });
}
