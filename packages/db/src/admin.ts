import { z } from "zod";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { recordAudit, type AuditAction, type AuditActor } from "./audit-log";
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
  | "last_platform_admin";

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

const emailSchema = z.email().max(254);

/** Normalizes and checks the address; throws `invalid_email` before anything is written. */
function parseEmail(email: string): string {
  const address = normalizeEmail(email);
  if (!emailSchema.safeParse(address).success) throw new AdminError("invalid_email");
  return address;
}

/** `created` is true when the grant made a new, empty account for the address. */
export type RoleChange = { userId: string; changed: boolean; created?: boolean };

const PLATFORM_ADMIN_LOCK = 7_301_100_001;

/**
 * Every writer of users.is_platform_admin must take this lock (account deletion will too).
 * Serializes every change of the platform admin flag, so two revokes cannot both see "two admins".
 * Held until the transaction ends.
 */
export async function lockPlatformAdmins(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PLATFORM_ADMIN_LOCK})`);
}

async function requireOrganization(tx: DbTransaction, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!row) throw new AdminError("organization_not_found");
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

/** Finds the account by address, or creates an empty one. Safe when two callers do it at once. */
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
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, address));
  // A concurrent transaction that inserted the row has committed by now (the insert waited for it).
  if (!existing) throw new AdminError("user_not_found");
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

async function requireUser(tx: DbTransaction, email: string): Promise<string> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parseEmail(email)));
  if (!row) throw new AdminError("user_not_found");
  return row.id;
}

export async function createOrganization(
  db: Db,
  input: { name: string },
  actor: AuditActor,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({ name: input.name })
      .returning({ id: organizations.id });
    await recordAudit(tx, {
      actor,
      organizationId: row!.id,
      action: "organization.created",
      subject: { type: "organization", id: row!.id },
    });
    return { id: row!.id };
  });
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

export async function listOrganizations(db: Db): Promise<
  {
    id: string;
    name: string;
    workingGroups: { id: string; name: string; city: string; active: boolean }[];
  }[]
> {
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
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
    // Another platform admin must remain who has logged in at least once (the first login
    // verifies the address). An account this tool made for a mistyped address never logs in,
    // so it does not count. Account deletion must apply the same rule.
    const [{ others } = { others: 0 }] = await tx
      .select({ others: count() })
      .from(users)
      .where(
        and(eq(users.isPlatformAdmin, true), eq(users.emailVerified, true), ne(users.id, userId)),
      );
    if (others === 0) throw new AdminError("last_platform_admin");
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

export async function revokeOrganizationAdmin(
  db: Db,
  input: { email: string; organizationId: string },
  actor: AuditActor,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    await requireOrganization(tx, input.organizationId);
    const userId = await requireUser(tx, input.email);
    const deleted = await tx
      .delete(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.userId, userId),
          eq(organizationAdmins.organizationId, input.organizationId),
        ),
      )
      .returning({ userId: organizationAdmins.userId });
    if (deleted.length === 0) return { userId, changed: false };
    await recordRoleChange(
      tx,
      actor,
      input.organizationId,
      "role.organization_admin_revoked",
      userId,
    );
    return { userId, changed: true };
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
