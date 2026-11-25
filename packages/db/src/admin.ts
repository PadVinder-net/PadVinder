import { DELETED_ACCOUNT_EMAIL_DOMAIN, emailAddressSchema } from "@padvinder/contracts";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { recordAudit, type AuditAction, type AuditActor, type AuditDetails } from "./audit-log";
import type { Db, DbTransaction } from "./client";
import type { QueueMail } from "./mail-jobs";
import { notifyAccessChanged } from "./notifications";
import {
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

export type AdminErrorCode =
  | "organization_not_found"
  | "working_group_not_found"
  | "working_group_inactive"
  | "user_not_found"
  | "invalid_email"
  | "invalid_name"
  | "name_taken"
  | "last_platform_admin"
  | "last_organization_admin"
  | "membership_not_found"
  | "last_coordinator"
  | "no_coordinator"
  | "person_outside_organization";

/** The input field an `invalid_name` is about. */
export type AdminErrorField = "name" | "city";

export class AdminError extends Error {
  /** For `invalid_name`: whether the name or the city is empty (default `name`). */
  readonly field?: AdminErrorField;

  constructor(
    readonly code: AdminErrorCode,
    message?: string,
    options: { field?: AdminErrorField } = {},
  ) {
    super(message ?? code);
    this.name = "AdminError";
    if (options.field) this.field = options.field;
  }
}

/** Trimmed and lowercase, so sloppy typing reaches the same account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalizes and checks the address by `emailAddressSchema`, the rule of every administration form,
 * before anything is written. The replaced address of a deleted account is `user_not_found`: that
 * account never gets a role again. Any other address the rule refuses is `invalid_email`.
 */
function parseEmail(email: string): string {
  const parsed = emailAddressSchema.safeParse(email);
  if (parsed.success) return parsed.data;
  if (normalizeEmail(email).endsWith(`@${DELETED_ACCOUNT_EMAIL_DOMAIN}`)) {
    throw new AdminError("user_not_found");
  }
  throw new AdminError("invalid_email");
}

/**
 * Trims and turns every run of whitespace into one space. Names of organizations and working
 * groups, and cities, are normalized with it before they are compared or stored.
 */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The normalized name or city; `invalid_name` (with the field) when nothing is left. The API's
 * request schemas refuse an empty one before this; the administration tool reaches it.
 */
function parseName(value: string, field: AdminErrorField): string {
  const name = normalizeName(value);
  if (name === "") throw new AdminError("invalid_name", `The ${field} is empty`, { field });
  return name;
}

/**
 * Whether the error is a unique_violation (23505) of the named index or constraint, also when
 * Drizzle wrapped the PostgreSQL error in a cause.
 */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  for (let e = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505" && constraint === constraintName) return true;
  }
  return false;
}

/** `created` is true when the grant made a new, empty account for the address. */
export type RoleChange = { userId: string; changed: boolean; created?: boolean };

/**
 * What the portal's endpoints pass so that an appointment mails the appointed person. The tool,
 * the seed and the tests pass nothing, and nothing is sent.
 */
export type AppointmentOptions = { queueMail?: QueueMail };

/**
 * The user who appoints someone and so tells them by mail, or null when no mail goes: without a
 * queue, when the system appoints (the tool, which passes none anyway: only the portal mails),
 * and when someone appoints themself.
 */
function mailingAppointer(
  actor: AuditActor,
  appointedUserId: string,
  options: AppointmentOptions | undefined,
): { queueMail: QueueMail; byUserId: string } | null {
  if (!options?.queueMail || actor.kind !== "user" || actor.userId === appointedUserId) return null;
  return { queueMail: options.queueMail, byUserId: actor.userId };
}

const PLATFORM_ADMIN_LOCK = 7_301_100_001;

/**
 * Every writer of users.is_platform_admin must take this lock (`deleteAccount` does too).
 * Serializes every change of the platform admin flag, so two revokes cannot both see "two admins".
 * Held until the transaction ends.
 */
export async function lockPlatformAdmins(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PLATFORM_ADMIN_LOCK})`);
}

/**
 * Whether another platform admin remains who has logged in at least once (the first login
 * verifies the address), besides `userId`. An account the tool made for a mistyped address never
 * logs in, so it does not count; neither does a deleted account (it has no flag and no verified
 * address). Call it under `lockPlatformAdmins`. Revoking and account deletion share this rule.
 */
export async function hasOtherPlatformAdmin(tx: DbTransaction, userId: string): Promise<boolean> {
  const [{ others } = { others: 0 }] = await tx
    .select({ others: count() })
    .from(users)
    .where(
      and(eq(users.isPlatformAdmin, true), eq(users.emailVerified, true), ne(users.id, userId)),
    );
  return others > 0;
}

async function requireOrganization(tx: DbTransaction, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!row) throw new AdminError("organization_not_found");
}

/**
 * A row lock on the organization, held until the transaction ends; `false` when there is none.
 * `for no key update`, so inserts that reference the organization (a working group, an admin row)
 * do not wait for it. Every function that removes an admin row takes it before it counts the
 * admins, so two removals at the same moment cannot both see "another admin remains".
 *
 * Take it before any user row lock. A transaction that holds it may wait for a user row: an audit
 * entry's `actor_user_id` and a role's `user_id` take a key share lock on the user (foreign keys),
 * and `findOrCreateUser` holds one. A function that locks a user row first and this lock second
 * can deadlock with it. `deleteAccount` does so only for a role that appeared between its two
 * reads, and accepts that narrow deadlock (PostgreSQL aborts one side, nothing is half written).
 */
export async function lockOrganization(
  tx: DbTransaction,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for("no key update");
  return row !== undefined;
}

/**
 * The number of admins of the organization. One who never logged in counts; a deleted account
 * has no admin rows left. Call it under `lockOrganization`.
 */
export async function countOrganizationAdmins(
  tx: DbTransaction,
  organizationId: string,
): Promise<number> {
  const [{ admins } = { admins: 0 }] = await tx
    .select({ admins: count() })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.organizationId, organizationId));
  return admins;
}

/**
 * Removes the admin row of the user, under the organization's lock; `last_organization_admin`
 * when no other admin of the organization would remain. An admin who never logged in counts.
 * The organization must be locked by the caller.
 */
async function removeAdminRow(
  tx: DbTransaction,
  organizationId: string,
  userId: string,
  actor: AuditActor,
): Promise<boolean> {
  const admins = await tx
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.organizationId, organizationId));
  if (!admins.some((admin) => admin.userId === userId)) return false;
  if (admins.length < 2) throw new AdminError("last_organization_admin");
  await tx
    .delete(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.userId, userId),
        eq(organizationAdmins.organizationId, organizationId),
      ),
    );
  await recordRoleChange(tx, actor, organizationId, "role.organization_admin_revoked", userId);
  return true;
}

/** The working group's organization. With `active`, an inactive group is `working_group_inactive`. */
async function requireWorkingGroup(
  tx: DbTransaction,
  workingGroupId: string,
  { active = false }: { active?: boolean } = {},
): Promise<string> {
  const [row] = await tx
    .select({ organizationId: workingGroups.organizationId, active: workingGroups.active })
    .from(workingGroups)
    .where(eq(workingGroups.id, workingGroupId));
  if (!row) throw new AdminError("working_group_not_found");
  // Memberships of an inactive group give no rights (`getAccess`), so a grant would do nothing.
  if (active && !row.active) throw new AdminError("working_group_inactive");
  return row.organizationId;
}

/**
 * Finds the account by address, or creates an empty one. Safe when two callers do it at once. A
 * deleted account (reachable only through its replaced address) is `user_not_found`: it never
 * gets a role again.
 *
 * The existing row is read `for key share` and stays locked until the transaction ends, so the
 * account cannot be deleted between this lookup and the insert of the role. A deletion that holds
 * the row (`for update`) makes this wait; then the address no longer matches, and the result is
 * `user_not_found`. When the deletion has already replaced the address, the insert waits for it
 * to commit and then makes a new account at the freed address. A deletion that comes later waits
 * for this transaction and counts the new role. A plain read would not do: the role's foreign key check waits for the deletion too, but
 * then accepts the row, whose id has not changed.
 */
async function findOrCreateUser(
  tx: DbTransaction,
  email: string,
): Promise<{ id: string; created: boolean }> {
  const address = parseEmail(email);
  const [created] = await tx
    .insert(users)
    .values({ name: "", email: address, emailVerified: false })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (created) return { id: created.id, created: true };
  const [existing] = await tx
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.email, address))
    .for("key share");
  // A concurrent transaction that inserted the row has committed by now (the insert waited for it).
  if (!existing || existing.deletedAt) throw new AdminError("user_not_found");
  return { id: existing.id, created: false };
}

/**
 * The account for the address, made empty when there is none. For the seed and other setup that
 * needs a person without a role. Throws `invalid_email` for an address that is not valid.
 */
export async function findOrCreateAccount(
  db: Db,
  email: string,
): Promise<{ id: string; created: boolean }> {
  return db.transaction((tx) => findOrCreateUser(tx, email));
}

/** The account with this address; a deleted account is `user_not_found`. */
async function requireUser(tx: DbTransaction, email: string): Promise<string> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, parseEmail(email)), isNull(users.deletedAt)));
  if (!row) throw new AdminError("user_not_found");
  return row.id;
}

/**
 * Creates the organization with its first admin, in one transaction: the organization, the
 * admin's account when there is none, the admin row, the entries `organization.created` and
 * `role.organization_admin_granted`, and `access-changed` for the admin. A name another
 * organization has, in any capitals or spacing, is `name_taken`; that includes one created at the
 * same moment. Throws `invalid_name` for a name that is empty after normalizing, `invalid_email`
 * for an address that is not valid, and `user_not_found` for the replaced address of a deleted
 * account; then nothing is written. With a queue (the portal), it queues `organization-admin` for
 * the admin in the same transaction, unless the actor named themself.
 */
export async function createOrganization(
  db: Db,
  input: { name: string; adminEmail: string; contactEmail?: string | null },
  actor: AuditActor,
  options?: AppointmentOptions,
): Promise<{ id: string; adminUserId: string; adminCreated: boolean }> {
  const name = parseName(input.name, "name");
  const adminEmail = parseEmail(input.adminEmail);
  const contactEmail = input.contactEmail == null ? null : parseEmail(input.contactEmail);
  return db.transaction(async (tx) => {
    // A second create of the same name waits here for the first to commit, then inserts nothing.
    const [row] = await tx
      .insert(organizations)
      .values({ name, contactEmail })
      .onConflictDoNothing()
      .returning({ id: organizations.id });
    if (!row) throw new AdminError("name_taken");
    await recordAudit(tx, {
      actor,
      organizationId: row.id,
      action: "organization.created",
      subject: { type: "organization", id: row.id },
    });
    const admin = await findOrCreateUser(tx, adminEmail);
    await tx.insert(organizationAdmins).values({ userId: admin.id, organizationId: row.id });
    await recordRoleChange(tx, actor, row.id, "role.organization_admin_granted", admin.id);
    const mailing = mailingAppointer(actor, admin.id, options);
    if (mailing) {
      await mailing.queueMail(tx, {
        kind: "organization-admin",
        userId: admin.id,
        organizationId: row.id,
      });
    }
    return { id: row.id, adminUserId: admin.id, adminCreated: admin.created };
  });
}

/**
 * Changes the name or the contact address, the keys present in `patch` (`null` empties the
 * contact address). The name is normalized, the address lowered; only a value that differs from
 * the stored one counts. A change writes one `organization.updated`, with `organizationNameFrom`
 * and `organizationNameTo` when the name changed and `contactChanged: true` when the contact
 * address changed (the address itself is never in the log). A patch that changes nothing writes
 * nothing. Throws `organization_not_found`, `name_taken`, `invalid_email`, and `invalid_name` for a
 * name that is empty after normalizing.
 */
export async function updateOrganization(
  db: Db,
  input: { organizationId: string; patch: { name?: string; contactEmail?: string | null } },
  actor: AuditActor,
): Promise<{ changed: boolean }> {
  const { patch } = input;
  const patchName = patch.name === undefined ? undefined : parseName(patch.name, "name");
  const contactEmail =
    patch.contactEmail === undefined || patch.contactEmail === null
      ? patch.contactEmail
      : parseEmail(patch.contactEmail);
  try {
    return await db.transaction(async (tx) => {
      const [stored] = await tx
        .select({ name: organizations.name, contactEmail: organizations.contactEmail })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .for("no key update");
      if (!stored) throw new AdminError("organization_not_found");
      const name = patchName ?? stored.name;
      const contact = contactEmail === undefined ? stored.contactEmail : contactEmail;

      const details: AuditDetails = {};
      if (name !== stored.name) {
        details.organizationNameFrom = stored.name;
        details.organizationNameTo = name;
      }
      if (contact !== stored.contactEmail) details.contactChanged = true;
      if (Object.keys(details).length === 0) return { changed: false };

      await tx
        .update(organizations)
        .set({ name, contactEmail: contact })
        .where(eq(organizations.id, input.organizationId));
      await recordAudit(tx, {
        actor,
        organizationId: input.organizationId,
        action: "organization.updated",
        subject: { type: "organization", id: input.organizationId },
        details,
      });
      return { changed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "organizations_name_key")) throw new AdminError("name_taken");
    throw error;
  }
}

/**
 * A row lock on the working group, held until the transaction ends; `null` when there is none.
 * `for no key update`, so inserts that reference the group (a membership, a request) do not wait.
 * Every function that removes a membership, clears the coordinator flag or changes `active` takes
 * it before it reads the coordinators, so two such changes at the same moment cannot both see
 * "another coordinator remains". A function that needs several takes them in the order of their
 * IDs.
 *
 * Take it before any user row lock. A transaction that holds it may wait for a user row: an audit
 * entry's `actor_user_id` and a role's `user_id` take a key share lock on the user (foreign keys),
 * and `findOrCreateUser` holds one. A function that locks a user row first and this lock second
 * can deadlock with it. `deleteAccount` does so only for a role that appeared between its two
 * reads, and accepts that narrow deadlock (PostgreSQL aborts one side, nothing is half written).
 */
export async function lockWorkingGroup(
  tx: DbTransaction,
  workingGroupId: string,
): Promise<{ organizationId: string; active: boolean } | null> {
  const [row] = await tx
    .select({ organizationId: workingGroups.organizationId, active: workingGroups.active })
    .from(workingGroups)
    .where(eq(workingGroups.id, workingGroupId))
    .for("no key update");
  return row ?? null;
}

/**
 * The number of coordinators of the group. One who never logged in counts; a deleted account
 * (which has no memberships left) does not. Call it under `lockWorkingGroup`.
 */
export async function countCoordinators(
  tx: DbTransaction,
  workingGroupId: string,
): Promise<number> {
  const [{ coordinators } = { coordinators: 0 }] = await tx
    .select({ coordinators: count() })
    .from(workingGroupMemberships)
    .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
    .where(
      and(
        eq(workingGroupMemberships.workingGroupId, workingGroupId),
        eq(workingGroupMemberships.isCoordinator, true),
        isNull(users.deletedAt),
      ),
    );
  return coordinators;
}

/**
 * Whether the coordinator flag of a membership may be cleared, or the membership removed: not
 * when it is the last coordinator of an active group. The group must be locked by the caller.
 */
async function assertNotLastCoordinator(
  tx: DbTransaction,
  workingGroupId: string,
  group: { active: boolean },
): Promise<void> {
  if (group.active && (await countCoordinators(tx, workingGroupId)) < 2) {
    throw new AdminError("last_coordinator");
  }
}

/**
 * Whether a user (not the system) may name the person with this address as the first
 * coordinator of a working group of the organization: themself; an address without an account,
 * or whose account never logged in; or someone with a membership of any working group of this
 * organization, or an admin of it. Anyone else has a profile outside the organization, and a
 * user may not pull them in: `person_outside_organization`.
 */
async function assertMayNameFirstCoordinator(
  tx: DbTransaction,
  organizationId: string,
  address: string,
  actor: AuditActor,
): Promise<void> {
  if (actor.kind === "system") return;
  const [person] = await tx
    .select({ id: users.id, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(and(eq(users.email, address), isNull(users.deletedAt)));
  if (!person || person.id === actor.userId || person.lastLoginAt === null) return;
  const [member] = await tx
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .where(
      and(
        eq(workingGroupMemberships.userId, person.id),
        eq(workingGroups.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (member) return;
  const [admin] = await tx
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.userId, person.id),
        eq(organizationAdmins.organizationId, organizationId),
      ),
    );
  if (!admin) throw new AdminError("person_outside_organization");
}

/**
 * Creates the working group with its first coordinator, in one transaction: the group, the
 * coordinator's account when there is none, the membership with the coordinator flag, the entries
 * `working_group.created` and `role.coordinator_granted`, and `access-changed` for the
 * coordinator. Name and city are normalized (`normalizeName`); a name another group of the
 * organization has is `name_taken`, also one created at the same moment. Throws
 * `organization_not_found`, `invalid_email`, `user_not_found` (the replaced address of a deleted
 * account) and `person_outside_organization` (see `assertMayNameFirstCoordinator`; the system
 * may name anyone), and `invalid_name` (with `field`) for an empty name or city. Then nothing is
 * written. With a queue (the portal), it queues `first-coordinator` for the coordinator in the
 * same transaction, unless the actor named themself.
 */
export async function createWorkingGroup(
  db: Db,
  input: { organizationId: string; name: string; city: string; coordinatorEmail: string },
  actor: AuditActor,
  options?: AppointmentOptions,
): Promise<{ id: string; coordinatorUserId: string; coordinatorCreated: boolean }> {
  const name = parseName(input.name, "name");
  const city = parseName(input.city, "city");
  const coordinatorEmail = parseEmail(input.coordinatorEmail);
  return db.transaction(async (tx) => {
    await requireOrganization(tx, input.organizationId);
    // A second create of the same name waits here for the first to commit, then inserts nothing.
    const [row] = await tx
      .insert(workingGroups)
      .values({ organizationId: input.organizationId, name, city })
      .onConflictDoNothing()
      .returning({ id: workingGroups.id });
    if (!row) throw new AdminError("name_taken");
    await recordAudit(tx, {
      actor,
      organizationId: input.organizationId,
      action: "working_group.created",
      subject: { type: "working_group", id: row.id },
    });
    await assertMayNameFirstCoordinator(tx, input.organizationId, coordinatorEmail, actor);
    const coordinator = await findOrCreateUser(tx, coordinatorEmail);
    const [membership] = await tx
      .insert(workingGroupMemberships)
      .values({ userId: coordinator.id, workingGroupId: row.id, isCoordinator: true })
      .returning({ id: workingGroupMemberships.id });
    await recordRoleChange(
      tx,
      actor,
      input.organizationId,
      "role.coordinator_granted",
      coordinator.id,
      { workingGroupId: row.id },
    );
    const mailing = mailingAppointer(actor, coordinator.id, options);
    if (mailing) {
      await mailing.queueMail(tx, {
        kind: "first-coordinator",
        membershipId: membership!.id,
        byUserId: mailing.byUserId,
      });
    }
    return {
      id: row.id,
      coordinatorUserId: coordinator.id,
      coordinatorCreated: coordinator.created,
    };
  });
}

/**
 * Changes the name, the city or the active flag, the keys present in `patch`. Name and city are
 * normalized; only a value that differs from the stored one counts. A changed name or city writes
 * one `working_group.updated` with, for each changed field only, the old and new value
 * (`workingGroupNameFrom`/`To`, `cityFrom`/`To`). A changed `active` writes its own entry,
 * `working_group.deactivated` or `working_group.activated`, and sends `access-changed` to every
 * member, whose access gains or loses the group. A patch that changes nothing writes and sends
 * nothing. Throws `working_group_not_found`, `name_taken` (another group of the organization has
 * the name), `invalid_name` (with `field`) for a name or city that is empty after normalizing,
 * and `no_coordinator` when it would switch on a group without a coordinator.
 */
export async function updateWorkingGroup(
  db: Db,
  input: { workingGroupId: string; patch: { name?: string; city?: string; active?: boolean } },
  actor: AuditActor,
): Promise<{ changed: boolean }> {
  const { workingGroupId, patch } = input;
  const patchName = patch.name === undefined ? undefined : parseName(patch.name, "name");
  const patchCity = patch.city === undefined ? undefined : parseName(patch.city, "city");
  try {
    return await db.transaction(async (tx) => {
      const group = await lockWorkingGroup(tx, workingGroupId);
      if (!group) throw new AdminError("working_group_not_found");
      const [stored] = await tx
        .select({ name: workingGroups.name, city: workingGroups.city })
        .from(workingGroups)
        .where(eq(workingGroups.id, workingGroupId));
      const name = patchName ?? stored!.name;
      const city = patchCity ?? stored!.city;
      const active = patch.active ?? group.active;

      const details: AuditDetails = {};
      if (name !== stored!.name) {
        details.workingGroupNameFrom = stored!.name;
        details.workingGroupNameTo = name;
      }
      if (city !== stored!.city) {
        details.cityFrom = stored!.city;
        details.cityTo = city;
      }
      const activeChanged = active !== group.active;
      if (Object.keys(details).length === 0 && !activeChanged) return { changed: false };
      if (activeChanged && active && (await countCoordinators(tx, workingGroupId)) === 0) {
        throw new AdminError("no_coordinator");
      }

      await tx
        .update(workingGroups)
        .set({ name, city, active })
        .where(eq(workingGroups.id, workingGroupId));
      const subject = { type: "working_group", id: workingGroupId } as const;
      const organizationId = group.organizationId;
      if (Object.keys(details).length > 0) {
        await recordAudit(tx, {
          actor,
          organizationId,
          action: "working_group.updated",
          subject,
          details,
        });
      }
      if (activeChanged) {
        await recordAudit(tx, {
          actor,
          organizationId,
          action: active ? "working_group.activated" : "working_group.deactivated",
          subject,
        });
        const members = await tx
          .select({ userId: workingGroupMemberships.userId })
          .from(workingGroupMemberships)
          .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
          .where(
            and(
              eq(workingGroupMemberships.workingGroupId, workingGroupId),
              isNull(users.deletedAt),
            ),
          );
        for (const member of members) await notifyAccessChanged(tx, member.userId);
      }
      return { changed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "working_groups_name_key")) {
      throw new AdminError("name_taken");
    }
    throw error;
  }
}

/**
 * Sets or clears the coordinator flag of a membership (the portal), also in an inactive group.
 * Throws `membership_not_found`, and `last_coordinator` when it would clear the flag of the last
 * coordinator of an active group. Writes `role.coordinator_granted` or `role.coordinator_revoked`
 * and sends `access-changed`, only when something changed.
 */
export async function setCoordinator(
  db: Db,
  input: { membershipId: string; isCoordinator: boolean },
  actor: AuditActor,
): Promise<{ changed: boolean; userId: string; workingGroupId: string }> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ workingGroupId: workingGroupMemberships.workingGroupId })
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.id, input.membershipId));
    if (!found) throw new AdminError("membership_not_found");
    const { workingGroupId } = found;
    const group = await lockWorkingGroup(tx, workingGroupId);
    // Read again under the lock: a change that committed in between counts.
    const [membership] = await tx
      .select({
        userId: workingGroupMemberships.userId,
        isCoordinator: workingGroupMemberships.isCoordinator,
      })
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.id, input.membershipId));
    if (!group || !membership) throw new AdminError("membership_not_found");
    const { userId } = membership;
    if (membership.isCoordinator === input.isCoordinator) {
      return { changed: false, userId, workingGroupId };
    }
    if (!input.isCoordinator) await assertNotLastCoordinator(tx, workingGroupId, group);
    await tx
      .update(workingGroupMemberships)
      .set({ isCoordinator: input.isCoordinator })
      .where(eq(workingGroupMemberships.id, input.membershipId));
    await recordRoleChange(
      tx,
      actor,
      group.organizationId,
      input.isCoordinator ? "role.coordinator_granted" : "role.coordinator_revoked",
      userId,
      { workingGroupId },
    );
    return { changed: true, userId, workingGroupId };
  });
}

/**
 * Every organization, for the tool. `hasAdmin` is false, and `hasCoordinator` false for an active
 * group, only for data from before the rules.
 */
export async function listOrganizations(db: Db): Promise<
  {
    id: string;
    name: string;
    hasAdmin: boolean;
    workingGroups: {
      id: string;
      name: string;
      city: string;
      active: boolean;
      /** False for a group without a coordinator: allowed only while it is switched off. */
      hasCoordinator: boolean;
    }[];
  }[]
> {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      hasAdmin: sql<boolean>`exists (select 1 from ${organizationAdmins} where ${organizationAdmins.organizationId} = ${organizations.id})`,
    })
    .from(organizations)
    .orderBy(sql`${organizations.name} COLLATE "nl-NL-x-icu"`, asc(organizations.id));
  const groups = await db
    .select({
      id: workingGroups.id,
      organizationId: workingGroups.organizationId,
      name: workingGroups.name,
      city: workingGroups.city,
      active: workingGroups.active,
      hasCoordinator: sql<boolean>`exists (select 1 from ${workingGroupMemberships} where ${workingGroupMemberships.workingGroupId} = ${workingGroups.id} and ${workingGroupMemberships.isCoordinator})`,
    })
    .from(workingGroups)
    .orderBy(sql`${workingGroups.name} COLLATE "nl-NL-x-icu"`, asc(workingGroups.id));
  return orgs.map((org) => ({
    ...org,
    workingGroups: groups
      .filter((group) => group.organizationId === org.id)
      .map(({ organizationId: _organizationId, ...group }) => group),
  }));
}

/**
 * Records a change of the user's rights: the audit entry, and the access-changed event that makes
 * their open apps and streams load the new rights. Only for a change that happened.
 */
async function recordRoleChange(
  tx: DbTransaction,
  actor: AuditActor,
  organizationId: string | null,
  action: AuditAction,
  userId: string,
  details?: Record<string, string>,
): Promise<void> {
  await recordAudit(tx, {
    actor,
    organizationId,
    action,
    subject: { type: "user", id: userId },
    details,
  });
  await notifyAccessChanged(tx, userId);
}

export async function grantPlatformAdmin(
  db: Db,
  input: { email: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    await lockPlatformAdmins(tx);
    const { id: userId, created } = await findOrCreateUser(tx, input.email);
    const updated = await tx
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(and(eq(users.id, userId), eq(users.isPlatformAdmin, false)))
      .returning({ id: users.id });
    if (updated.length === 0) return { userId, changed: false, created };
    await recordRoleChange(tx, actor, null, "role.platform_admin_granted", userId);
    return { userId, changed: true, created };
  });
}

export async function revokePlatformAdmin(
  db: Db,
  input: { email: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    // A second revoke waits for the lock, then counts again.
    await lockPlatformAdmins(tx);
    const userId = await requireUser(tx, input.email);
    const [target] = await tx
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, userId));
    if (!target?.isPlatformAdmin) return { userId, changed: false };
    if (!(await hasOtherPlatformAdmin(tx, userId))) throw new AdminError("last_platform_admin");
    await tx.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, userId));
    await recordRoleChange(tx, actor, null, "role.platform_admin_revoked", userId);
    return { userId, changed: true };
  });
}

/**
 * Makes the person an admin of the organization, by address; an address without an account gets
 * one. `changed: false` when they were already. With a queue (the portal), a new admin row queues
 * `organization-admin` for them, unless they appointed themself.
 */
export async function grantOrganizationAdmin(
  db: Db,
  input: { email: string; organizationId: string },
  actor: AuditActor,
  options?: AppointmentOptions,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    await requireOrganization(tx, input.organizationId);
    const { id: userId, created } = await findOrCreateUser(tx, input.email);
    const inserted = await tx
      .insert(organizationAdmins)
      .values({ userId, organizationId: input.organizationId })
      .onConflictDoNothing()
      .returning({ userId: organizationAdmins.userId });
    if (inserted.length === 0) return { userId, changed: false, created };
    await recordRoleChange(
      tx,
      actor,
      input.organizationId,
      "role.organization_admin_granted",
      userId,
    );
    const mailing = mailingAppointer(actor, userId, options);
    if (mailing) {
      await mailing.queueMail(tx, {
        kind: "organization-admin",
        userId,
        organizationId: input.organizationId,
      });
    }
    return { userId, changed: true, created };
  });
}

/**
 * Takes the admin role away, by address (the tool). Throws `last_organization_admin` when no
 * other admin of the organization would remain.
 */
export async function revokeOrganizationAdmin(
  db: Db,
  input: { email: string; organizationId: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    if (!(await lockOrganization(tx, input.organizationId))) {
      throw new AdminError("organization_not_found");
    }
    const userId = await requireUser(tx, input.email);
    const changed = await removeAdminRow(tx, input.organizationId, userId, actor);
    return { userId, changed };
  });
}

/**
 * Takes the admin role away, by user ID (the portal). `changed: false` when that user is no admin
 * there. Throws `organization_not_found`, and `last_organization_admin` when no other admin of
 * the organization would remain.
 */
export async function removeOrganizationAdmin(
  db: Db,
  input: { organizationId: string; userId: string },
  actor: AuditActor,
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    if (!(await lockOrganization(tx, input.organizationId))) {
      throw new AdminError("organization_not_found");
    }
    return { changed: await removeAdminRow(tx, input.organizationId, input.userId, actor) };
  });
}

export async function grantCoordinator(
  db: Db,
  input: { email: string; workingGroupId: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    const organizationId = await requireWorkingGroup(tx, input.workingGroupId, { active: true });
    const { id: userId, created } = await findOrCreateUser(tx, input.email);
    // One statement: insert, or raise a volunteer; a coordinator row is left alone (no row returned).
    const changed = await tx
      .insert(workingGroupMemberships)
      .values({ userId, workingGroupId: input.workingGroupId, isCoordinator: true })
      .onConflictDoUpdate({
        target: [workingGroupMemberships.userId, workingGroupMemberships.workingGroupId],
        set: { isCoordinator: true },
        setWhere: eq(workingGroupMemberships.isCoordinator, false),
      })
      .returning({ id: workingGroupMemberships.id });
    if (changed.length === 0) return { userId, changed: false, created };
    await recordRoleChange(tx, actor, organizationId, "role.coordinator_granted", userId, {
      workingGroupId: input.workingGroupId,
    });
    return { userId, changed: true, created };
  });
}

/**
 * Takes the coordinator role away, by address (the tool); the person stays a volunteer of the
 * group. Throws `working_group_not_found`, `user_not_found`, and `last_coordinator` when it would
 * take it from the last coordinator of an active group.
 */
export async function revokeCoordinator(
  db: Db,
  input: { email: string; workingGroupId: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    const group = await lockWorkingGroup(tx, input.workingGroupId);
    if (!group) throw new AdminError("working_group_not_found");
    const userId = await requireUser(tx, input.email);
    const [membership] = await tx
      .select({ isCoordinator: workingGroupMemberships.isCoordinator })
      .from(workingGroupMemberships)
      .where(
        and(
          eq(workingGroupMemberships.userId, userId),
          eq(workingGroupMemberships.workingGroupId, input.workingGroupId),
        ),
      );
    if (!membership?.isCoordinator) return { userId, changed: false };
    await assertNotLastCoordinator(tx, input.workingGroupId, group);
    await tx
      .update(workingGroupMemberships)
      .set({ isCoordinator: false })
      .where(
        and(
          eq(workingGroupMemberships.userId, userId),
          eq(workingGroupMemberships.workingGroupId, input.workingGroupId),
        ),
      );
    await recordRoleChange(tx, actor, group.organizationId, "role.coordinator_revoked", userId, {
      workingGroupId: input.workingGroupId,
    });
    return { userId, changed: true };
  });
}
