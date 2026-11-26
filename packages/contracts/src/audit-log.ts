import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });

/**
 * Every action the audit log holds today. An entry's `action` stays a text in the API, because an
 * open portal may meet an action that a newer API writes.
 */
export const auditActions = [
  "organization.created",
  "organization.updated",
  "working_group.created",
  "working_group.updated",
  "working_group.deactivated",
  "working_group.activated",
  "role.platform_admin_granted",
  "role.platform_admin_revoked",
  "role.organization_admin_granted",
  "role.organization_admin_revoked",
  "role.coordinator_granted",
  "role.coordinator_revoked",
  "membership_request.approved",
  "membership_request.rejected",
  "membership.added",
  "membership.invited",
  "membership.removed",
  "account.deleted",
  "species.created",
  "species.updated",
  "species.deactivated",
  "species.activated",
] as const;
export type AuditAction = (typeof auditActions)[number];

/** The kinds of action the audit log page filters on. */
export const auditActionGroups = [
  "organization",
  "workingGroup",
  "role",
  "membership",
  "account",
  "species",
] as const;
export type AuditActionGroup = (typeof auditActionGroups)[number];
export const auditActionGroupSchema = z.enum(auditActionGroups).meta({ id: "AuditActionGroup" });

/** A group matches its actions by prefix, so a later action falls into its group by itself. */
export const auditActionPrefixes: Record<AuditActionGroup, readonly string[]> = {
  organization: ["organization."],
  workingGroup: ["working_group."],
  role: ["role."],
  membership: ["membership.", "membership_request."],
  account: ["account."],
  species: ["species."],
};

export const AUDIT_LOG_PAGE_SIZE = 50;

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d{6}Z_(.+)$/;

/** Whether the date and time exist (no 30 February, no hour 24): they survive a round trip. */
function isRealMoment(toTheSecond: string): boolean {
  const date = new Date(`${toTheSecond}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === toTheSecond;
}

/**
 * Where the next page starts: `{occurredAt}_{id}` of the last entry of a page, with the moment in
 * UTC with six decimals (`2026-11-25T19:04:05.123456Z`). Plain text, so it can be read and sent
 * with `curl`. The server makes it and reads it back as a `timestamptz`, never as a JavaScript
 * date, which would cut the microseconds.
 */
export const auditLogCursorSchema = z.string().refine(
  (cursor) => {
    const match = CURSOR_PATTERN.exec(cursor);
    return match !== null && isRealMoment(match[1]!) && z.uuid().safeParse(match[2]).success;
  },
  { message: "Not a cursor of the audit log" },
);

/** The moment and the ID of a cursor that `auditLogCursorSchema` accepted. */
export function splitAuditLogCursor(cursor: string): { occurredAt: string; id: string } {
  const at = cursor.indexOf("_");
  return { occurredAt: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

/**
 * Who acted, or whom an entry is about, as the reader may see them. `named` carries the current
 * name (empty when the person never gave one) and whether they ever logged in; the other kinds
 * carry neither: `former_member` is someone no longer connected to the entry's organization,
 * `deleted_account` a deleted account, `platform_admin` a platform admin who is not connected,
 * and `system` the administration tool.
 */
export const auditLogPersonSchema = z
  .object({
    kind: z.enum(["named", "former_member", "deleted_account", "platform_admin", "system"]),
    name: z.string().optional(),
    hasLoggedIn: z.boolean().optional(),
  })
  .refine(
    (person) =>
      person.kind === "named"
        ? person.name !== undefined && person.hasLoggedIn !== undefined
        : person.name === undefined && person.hasLoggedIn === undefined,
    { message: "name and hasLoggedIn are present exactly for a named person" },
  )
  .meta({ id: "AuditLogPerson" });
export type AuditLogPerson = z.infer<typeof auditLogPersonSchema>;

/**
 * One entry, with the current names of what it is about. `details` holds which fields changed and
 * non-personal values, never a name of a person, an email address or a phone number.
 */
export const auditLogEntrySchema = z
  .object({
    id: z.string(),
    occurredAt: timestampSchema,
    action: z.string(),
    actor: auditLogPersonSchema,
    person: auditLogPersonSchema.nullable(),
    organization: z.object({ id: z.string(), name: z.string() }).nullable(),
    workingGroup: z.object({ id: z.string(), name: z.string() }).nullable(),
    species: z.object({ id: z.string(), dutchName: z.string() }).nullable(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .meta({ id: "AuditLogEntry" });
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Newest first. `nextCursor` asks for the entries after these; `null` on the last page. */
export const auditLogPageSchema = z
  .object({
    entries: z.array(auditLogEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "AuditLogPage" });
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

/** The filters narrow what the reader may see; they never widen it. */
export const listAuditLogEntriesQuerySchema = z.strictObject({
  organizationId: z.uuid().optional(),
  actionGroup: auditActionGroupSchema.optional(),
  cursor: auditLogCursorSchema.optional(),
});
export type ListAuditLogEntriesQuery = z.infer<typeof listAuditLogEntriesQuerySchema>;
