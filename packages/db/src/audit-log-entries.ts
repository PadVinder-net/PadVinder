import {
  AUDIT_LOG_PAGE_SIZE,
  auditActionPrefixes,
  auditLogCursorSchema,
  splitAuditLogCursor,
  type AuditActionGroup,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditLogPerson,
} from "@padvinder/contracts";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Access } from "./access";
import type { Db } from "./client";
import {
  auditLogEntries,
  membershipRequests,
  organizationAdmins,
  organizations,
  species,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { userHasLoggedIn } from "./users";

export type ListAuditLogEntriesInput = {
  organizationId?: string;
  actionGroup?: AuditActionGroup;
  /** From `nextCursor` of the previous page; checked with `auditLogCursorSchema`. */
  cursor?: string;
  /** Entries per page; `AUDIT_LOG_PAGE_SIZE` by default. */
  limit?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyPage: AuditLogPage = { entries: [], nextCursor: null };

/**
 * One page of the audit log, newest first (`occurred_at`, then `id`, descending), with the current
 * names of what each entry is about, by the rule on who sees names.
 *
 * Scope: a platform admin reads every entry; anyone else the entries of the organizations they
 * administer, so never an entry without an organization. The filters narrow the scope, never widen
 * it. Paging compares (`occurred_at`, `id`) as a row with the cursor's pair, which PostgreSQL made
 * and reads back as a `timestamptz` with all six decimals, so an entry written between two pages
 * shifts nothing and entries microseconds apart are each read once.
 *
 * A person is `system` for the tool, `deleted_account` for a deleted account, `named` for a
 * platform admin reader and otherwise for someone connected to the entry's organization now (a
 * membership of one of its working groups, also one switched off, a pending request for one, or an
 * admin row), `platform_admin` for a platform admin who is not, and `former_member` for everyone
 * else. The answer holds no user ID and no email address.
 *
 * At most four queries, whatever the page size: the entries, then the people, the working groups
 * and the species they mention.
 */
export async function listAuditLogEntries(
  db: Db,
  access: Pick<Access, "isPlatformAdmin" | "adminOfOrganizationIds">,
  input: ListAuditLogEntriesInput,
): Promise<AuditLogPage> {
  const limit = input.limit ?? AUDIT_LOG_PAGE_SIZE;
  const conditions: (SQL | undefined)[] = [];
  if (!access.isPlatformAdmin) {
    if (access.adminOfOrganizationIds.length === 0) return emptyPage;
    conditions.push(inArray(auditLogEntries.organizationId, access.adminOfOrganizationIds));
  }
  if (input.organizationId !== undefined) {
    conditions.push(eq(auditLogEntries.organizationId, input.organizationId));
  }
  if (input.actionGroup !== undefined) {
    conditions.push(
      or(
        ...auditActionPrefixes[input.actionGroup].map(
          (prefix) => sql`starts_with(${auditLogEntries.action}, ${prefix})`,
        ),
      ),
    );
  }
  if (input.cursor !== undefined) {
    const cursor = splitAuditLogCursor(auditLogCursorSchema.parse(input.cursor));
    conditions.push(
      sql`(${auditLogEntries.occurredAt}, ${auditLogEntries.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      id: auditLogEntries.id,
      occurredAt: auditLogEntries.occurredAt,
      cursorMoment: sql<string>`to_char(${auditLogEntries.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      actorKind: auditLogEntries.actorKind,
      actorUserId: auditLogEntries.actorUserId,
      organizationId: auditLogEntries.organizationId,
      organizationName: organizations.name,
      action: auditLogEntries.action,
      subjectType: auditLogEntries.subjectType,
      subjectId: auditLogEntries.subjectId,
      details: auditLogEntries.details,
      applicantId: membershipRequests.userId,
    })
    .from(auditLogEntries)
    .leftJoin(organizations, eq(organizations.id, auditLogEntries.organizationId))
    .leftJoin(
      membershipRequests,
      and(
        eq(auditLogEntries.subjectType, "membership_request"),
        eq(membershipRequests.id, auditLogEntries.subjectId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(auditLogEntries.occurredAt), desc(auditLogEntries.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? `${last.cursorMoment}_${last.id}` : null;

  const personOf = (row: (typeof page)[number]): string | null =>
    row.subjectType === "user"
      ? row.subjectId
      : row.subjectType === "membership_request"
        ? row.applicantId
        : null;
  const workingGroupOf = (row: (typeof page)[number]): string | null => {
    if (row.subjectType === "working_group") return row.subjectId;
    const fromDetails = row.details.workingGroupId;
    return typeof fromDetails === "string" && UUID.test(fromDetails) ? fromDetails : null;
  };

  const personIds = new Set<string>();
  const workingGroupIds = new Set<string>();
  const speciesIds = new Set<string>();
  const organizationIds = new Set<string>();
  for (const row of page) {
    if (row.actorUserId) personIds.add(row.actorUserId);
    const person = personOf(row);
    if (person) personIds.add(person);
    const workingGroup = workingGroupOf(row);
    if (workingGroup) workingGroupIds.add(workingGroup);
    if (row.subjectType === "species") speciesIds.add(row.subjectId);
    if (row.organizationId) organizationIds.add(row.organizationId);
  }

  const [people, groups, speciesRows] = await Promise.all([
    loadPeople(db, [...personIds], access.isPlatformAdmin ? null : [...organizationIds]),
    workingGroupIds.size === 0
      ? []
      : db
          .select({
            id: workingGroups.id,
            name: workingGroups.name,
            organizationId: workingGroups.organizationId,
          })
          .from(workingGroups)
          .where(inArray(workingGroups.id, [...workingGroupIds])),
    speciesIds.size === 0
      ? []
      : db
          .select({ id: species.id, dutchName: species.dutchName })
          .from(species)
          .where(inArray(species.id, [...speciesIds])),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const speciesById = new Map(speciesRows.map((row) => [row.id, row]));

  const describe = (userId: string, organizationId: string | null): AuditLogPerson => {
    const person = peopleById.get(userId);
    if (!person) return { kind: "former_member" };
    if (person.deleted) return { kind: "deleted_account" };
    if (
      access.isPlatformAdmin ||
      (organizationId !== null && person.organizationIds.includes(organizationId))
    ) {
      return { kind: "named", name: person.name, hasLoggedIn: person.hasLoggedIn };
    }
    return person.isPlatformAdmin ? { kind: "platform_admin" } : { kind: "former_member" };
  };

  const entries = page.map((row): AuditLogEntry => {
    const personId = personOf(row);
    const groupId = workingGroupOf(row);
    const group = groupId ? groupsById.get(groupId) : undefined;
    const kind = row.subjectType === "species" ? speciesById.get(row.subjectId) : undefined;
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      action: row.action,
      actor:
        row.actorKind === "system" || !row.actorUserId
          ? { kind: "system" }
          : describe(row.actorUserId, row.organizationId),
      person: personId ? describe(personId, row.organizationId) : null,
      organization:
        row.organizationId !== null && row.organizationName !== null
          ? { id: row.organizationId, name: row.organizationName }
          : null,
      workingGroup:
        group && (access.isPlatformAdmin || group.organizationId === row.organizationId)
          ? { id: group.id, name: group.name }
          : null,
      species: kind ? { id: kind.id, dutchName: kind.dutchName } : null,
      details: row.details,
    };
  });
  return { entries, nextCursor };
}

type AuditLogPersonRow = {
  id: string;
  name: string;
  deleted: boolean;
  isPlatformAdmin: boolean;
  hasLoggedIn: boolean;
  /** The given organizations the person is connected to now; empty for a platform admin reader. */
  organizationIds: string[];
};

/**
 * The people a page mentions, in one query. With `organizationIds` (a reader who is not a platform
 * admin), each person's connections among those organizations: a membership of one of its working
 * groups (active or not), a pending request for one, or an admin row.
 */
async function loadPeople(
  db: Db,
  ids: string[],
  organizationIds: string[] | null,
): Promise<AuditLogPersonRow[]> {
  if (ids.length === 0) return [];
  const connected =
    organizationIds === null
      ? sql<string[]>`'{}'::text[]`
      : sql<string[]>`array(
          select ${workingGroups.organizationId} from ${workingGroupMemberships}
          inner join ${workingGroups} on ${workingGroups.id} = ${workingGroupMemberships.workingGroupId}
          where ${workingGroupMemberships.userId} = ${users.id}
            and ${inArray(workingGroups.organizationId, organizationIds)}
          union
          select ${workingGroups.organizationId} from ${membershipRequests}
          inner join ${workingGroups} on ${workingGroups.id} = ${membershipRequests.workingGroupId}
          where ${membershipRequests.userId} = ${users.id}
            and ${membershipRequests.status} = 'pending'
            and ${inArray(workingGroups.organizationId, organizationIds)}
          union
          select ${organizationAdmins.organizationId} from ${organizationAdmins}
          where ${organizationAdmins.userId} = ${users.id}
            and ${inArray(organizationAdmins.organizationId, organizationIds)}
        )::text[]`;
  return db
    .select({
      id: users.id,
      name: users.name,
      deleted: sql<boolean>`${users.deletedAt} is not null`,
      isPlatformAdmin: users.isPlatformAdmin,
      hasLoggedIn: userHasLoggedIn,
      organizationIds: connected,
    })
    .from(users)
    .where(inArray(users.id, ids));
}
