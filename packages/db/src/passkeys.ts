import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { recordAudit } from "./audit-log";
import type { QueueMail } from "./mail-jobs";
import { notifyAccessChanged } from "./notifications";
import { organizationAdmins, passkeys, sessions, users } from "./schema";

/** The most passkeys one account may have. */
export const MAX_PASSKEYS_PER_ACCOUNT = 10;

/** Whether the user has at least one passkey, for lists of people. */
export const userHasPasskey = sql<boolean>`exists (select 1 from ${passkeys} where ${passkeys.userId} = ${users.id})`;

type MailOptions = { queueMail?: QueueMail };

/** The user's own passkeys, oldest first. Reads no key material. */
export async function listOwnPasskeys(
  db: Db,
  userId: string,
): Promise<{ id: string; createdAt: Date; backedUp: boolean }[]> {
  return db
    .select({ id: passkeys.id, createdAt: passkeys.createdAt, backedUp: passkeys.backedUp })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
}

export async function countPasskeys(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId));
  return row?.n ?? 0;
}

/**
 * Records that a passkey was added: the audit entry and the mail, in one transaction. Better Auth
 * inserted the row before this is called.
 */
export async function recordPasskeyAdded(
  db: Db,
  input: { userId: string; passkeyId: string },
  options: MailOptions,
): Promise<void> {
  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      actor: { kind: "user", userId: input.userId },
      organizationId: null,
      action: "passkey.added",
      subject: { type: "user", id: input.userId },
    });
    await options.queueMail?.(tx, {
      kind: "passkey-added",
      userId: input.userId,
      passkeyId: input.passkeyId,
    });
  });
}

/**
 * Removes one of the user's own passkeys; `not_found` for one that is someone else's or gone. The
 * sessions' confirmation moments stay.
 */
export async function removeOwnPasskey(
  db: Db,
  input: { userId: string; passkeyId: string },
  options: MailOptions,
): Promise<{ outcome: "removed" | "not_found" }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, input.passkeyId), eq(passkeys.userId, input.userId)))
      .returning({ id: passkeys.id });
    if (deleted.length === 0) return { outcome: "not_found" as const };
    await recordAudit(tx, {
      actor: { kind: "user", userId: input.userId },
      organizationId: null,
      action: "passkey.removed",
      subject: { type: "user", id: input.userId },
    });
    await options.queueMail?.(tx, {
      kind: "passkeys-removed",
      userId: input.userId,
      byUserId: input.userId,
    });
    return { outcome: "removed" as const };
  });
}

/**
 * Removes all of a person's passkeys on behalf of an admin, and deletes every session of that
 * person, so they are logged out on every device and log in again with a code. Clearing only the
 * confirmation is not enough: every passkey ceremony makes a new session, so a confirmed session
 * is always young enough for Better Auth's first-passkey rule (`freshAge`), and a thief's session
 * on a lost laptop could add a first passkey of their own. Sends `access-changed` for the person,
 * as `deleteAccount` does, so their open event streams reload, find no session and end. Writes the
 * entry and queues the mail when a passkey was removed or a session ended (a logout always leaves
 * a trace); with neither, nothing.
 */
export async function resetPasskeys(
  db: Db,
  input: { userId: string; organizationId: string | null },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<ResetResult> {
  return db.transaction((tx) => resetPasskeysIn(tx, input, actor, options));
}

/** How many passkeys a reset removed, and how many sessions it ended. */
export type ResetResult = { removed: number; sessionsEnded: number };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * An admin's reset, decided on what the route authorized. In one transaction it locks the
 * person's user row, checks that they are still the kind of admin the route meant (an admin of
 * `organizationId`, or with a null one a platform admin; not deleted) and that
 * `isPlatformAdmin` is still `expectedIsPlatformAdmin`, then resets (the user row first, then
 * the passkeys and sessions, the order of `deleteAccount`). `not_found` when they are
 * no such admin; `subject_changed` when they became or stopped being a platform admin since the
 * route decided (the route answers 409, as `expectedIsCoordinator` does for removing a member).
 */
export async function resetAdminPasskeys(
  db: Db,
  input: { userId: string; organizationId: string | null; expectedIsPlatformAdmin: boolean },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<({ outcome: "reset" } & ResetResult) | { outcome: "not_found" | "subject_changed" }> {
  return db.transaction(async (tx) => {
    const [subject] = await tx
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .for("update");
    if (!subject) return { outcome: "not_found" as const };
    if (input.organizationId === null) {
      if (!subject.isPlatformAdmin) return { outcome: "not_found" as const };
    } else {
      const [row] = await tx
        .select({ userId: organizationAdmins.userId })
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.organizationId, input.organizationId),
            eq(organizationAdmins.userId, input.userId),
          ),
        );
      if (!row) return { outcome: "not_found" as const };
    }
    if (subject.isPlatformAdmin !== input.expectedIsPlatformAdmin) {
      return { outcome: "subject_changed" as const };
    }
    const result = await resetPasskeysIn(tx, input, actor, options);
    return { outcome: "reset" as const, ...result };
  });
}

async function resetPasskeysIn(
  tx: Tx,
  input: { userId: string; organizationId: string | null },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<ResetResult> {
  const deleted = await tx
    .delete(passkeys)
    .where(eq(passkeys.userId, input.userId))
    .returning({ id: passkeys.id });
  const ended = await tx
    .delete(sessions)
    .where(eq(sessions.userId, input.userId))
    .returning({ id: sessions.id });
  if (deleted.length > 0 || ended.length > 0) {
    await recordAudit(tx, {
      actor,
      organizationId: input.organizationId,
      action: "passkey.reset",
      subject: { type: "user", id: input.userId },
    });
    await options.queueMail?.(tx, {
      kind: "passkeys-removed",
      userId: input.userId,
      byUserId: actor.userId,
    });
    await notifyAccessChanged(tx, input.userId);
  }
  return { removed: deleted.length, sessionsEnded: ended.length };
}
