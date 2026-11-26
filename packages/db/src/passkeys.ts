import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { recordAudit } from "./audit-log";
import type { QueueMail } from "./mail-jobs";
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
 * Removes all of a person's passkeys on behalf of an admin, and always clears the confirmation of
 * every session of that person, so a confirmed session on a lost laptop loses its admin power at
 * once. Writes the entry and queues the mail only when a passkey was removed.
 */
export async function resetPasskeys(
  db: Db,
  input: { userId: string; organizationId: string | null },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<{ removed: number }> {
  return db.transaction((tx) => resetPasskeysIn(tx, input, actor, options));
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * An admin's reset, decided on what the route authorized. In one transaction it locks the
 * person's user row, checks that they are still the kind of admin the route meant (an admin of
 * `organizationId`, or with a null one a platform admin; not deleted) and that
 * `isPlatformAdmin` is still `expectedIsPlatformAdmin`, then resets. `not_found` when they are
 * no such admin; `subject_changed` when they became or stopped being a platform admin since the
 * route decided (the route answers 409, as `expectedIsCoordinator` does for removing a member).
 */
export async function resetAdminPasskeys(
  db: Db,
  input: { userId: string; organizationId: string | null; expectedIsPlatformAdmin: boolean },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<{ outcome: "reset"; removed: number } | { outcome: "not_found" | "subject_changed" }> {
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
    const { removed } = await resetPasskeysIn(tx, input, actor, options);
    return { outcome: "reset" as const, removed };
  });
}

async function resetPasskeysIn(
  tx: Tx,
  input: { userId: string; organizationId: string | null },
  actor: { kind: "user"; userId: string },
  options: MailOptions,
): Promise<{ removed: number }> {
  {
    const deleted = await tx
      .delete(passkeys)
      .where(eq(passkeys.userId, input.userId))
      .returning({ id: passkeys.id });
    await tx
      .update(sessions)
      .set({ passkeyVerifiedAt: null })
      .where(eq(sessions.userId, input.userId));
    if (deleted.length > 0) {
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
    }
    return { removed: deleted.length };
  }
}
