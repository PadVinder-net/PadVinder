import { DELETED_ACCOUNT_EMAIL_DOMAIN, emailAddressSchema } from "@padvinder/contracts";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { recordAudit, type AuditAction, type AuditActor, type AuditDetails } from "./audit-log";
import type { Db, DbTransaction } from "./client";
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
  | "name_taken"
  | "last_platform_admin"
  | "last_organization_admin";

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AdminError";
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
    .where(eq(users.email, address));
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
 * same moment. Throws `invalid_email` for an address that is not valid, and `user_not_found` for
 * the replaced address of a deleted account; then nothing is written.
 */
export async function createOrganization(
  db: Db,
  input: { name: string; adminEmail: string; contactEmail?: string | null },
  actor: AuditActor,
): Promise<{ id: string; adminUserId: string; adminCreated: boolean }> {
  const adminEmail = parseEmail(input.adminEmail);
  const contactEmail = input.contactEmail == null ? null : parseEmail(input.contactEmail);
  return db.transaction(async (tx) => {
    // A second create of the same name waits here for the first to commit, then inserts nothing.
    const [row] = await tx
      .insert(organizations)
      .values({ name: normalizeName(input.name), contactEmail })
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
    return { id: row.id, adminUserId: admin.id, adminCreated: admin.created };
  });
}

/**
 * Changes the name or the contact address, the keys present in `patch` (`null` empties the
 * contact address). The name is normalized, the address lowered; only a value that differs from
 * the stored one counts. A change writes one `organization.updated`, with `organizationNameFrom`
 * and `organizationNameTo` when the name changed and `contactChanged: true` when the contact
 * address changed (the address itself is never in the log). A patch that changes nothing writes
 * nothing. Throws `organization_not_found`, `name_taken` and `invalid_email`.
 */
export async function updateOrganization(
  db: Db,
  input: { organizationId: string; patch: { name?: string; contactEmail?: string | null } },
  actor: AuditActor,
): Promise<{ changed: boolean }> {
  const { patch } = input;
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
      const name = patch.name === undefined ? stored.name : normalizeName(patch.name);
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

export async function createWorkingGroup(
  db: Db,
  input: { organizationId: string; name: string; city: string },
  actor: AuditActor,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await requireOrganization(tx, input.organizationId);
    const [row] = await tx
      .insert(workingGroups)
      .values({ organizationId: input.organizationId, name: input.name, city: input.city })
      .onConflictDoNothing({ target: [workingGroups.organizationId, workingGroups.name] })
      .returning({ id: workingGroups.id });
    if (!row) throw new AdminError("name_taken");
    await recordAudit(tx, {
      actor,
      organizationId: input.organizationId,
      action: "working_group.created",
      subject: { type: "working_group", id: row.id },
    });
    return { id: row.id };
  });
}

/** Every organization, for the tool. `hasAdmin` is false only for data from before the rule. */
export async function listOrganizations(db: Db): Promise<
  {
    id: string;
    name: string;
    hasAdmin: boolean;
    workingGroups: { id: string; name: string; city: string; active: boolean }[];
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

export async function grantOrganizationAdmin(
  db: Db,
  input: { email: string; organizationId: string },
  actor: AuditActor,
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

export async function revokeCoordinator(
  db: Db,
  input: { email: string; workingGroupId: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    const organizationId = await requireWorkingGroup(tx, input.workingGroupId);
    const userId = await requireUser(tx, input.email);
    const updated = await tx
      .update(workingGroupMemberships)
      .set({ isCoordinator: false })
      .where(
        and(
          eq(workingGroupMemberships.userId, userId),
          eq(workingGroupMemberships.workingGroupId, input.workingGroupId),
          eq(workingGroupMemberships.isCoordinator, true),
        ),
      )
      .returning({ id: workingGroupMemberships.id });
    if (updated.length === 0) return { userId, changed: false };
    await recordRoleChange(tx, actor, organizationId, "role.coordinator_revoked", userId, {
      workingGroupId: input.workingGroupId,
    });
    return { userId, changed: true };
  });
}
