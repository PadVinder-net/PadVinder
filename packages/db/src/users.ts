import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { users } from "./schema";

/** Whether the user has ever logged in: `users.last_login_at is not null`. */
export const userHasLoggedIn = sql<boolean>`${users.lastLoginAt} is not null`;

export type UserProfile = { id: string; name: string; email: string; phone: string | null };

const profileColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
};

/** The user, unless they do not exist or deleted their account. */
const activeUser = (userId: string) => and(eq(users.id, userId), isNull(users.deletedAt));

/** `null` when the user does not exist or deleted their account. */
export async function getUserProfile(db: Db, userId: string): Promise<UserProfile | null> {
  const [row] = await db.select(profileColumns).from(users).where(activeUser(userId));
  return row ?? null;
}

/**
 * Changes only the keys that are present in the patch. `null` when the user does not exist or
 * deleted their account: a change that arrives after the deletion never writes a name back.
 */
export async function updateUserProfile(
  db: Db,
  userId: string,
  patch: { name?: string; phone?: string | null },
): Promise<UserProfile | null> {
  const changes: { name?: string; phone?: string | null } = {};
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.phone !== undefined) changes.phone = patch.phone;
  const [row] =
    Object.keys(changes).length === 0
      ? await db.select(profileColumns).from(users).where(activeUser(userId))
      : await db
          .update(users)
          .set({ ...changes, updatedAt: new Date() })
          .where(activeUser(userId))
          .returning(profileColumns);
  return row ?? null;
}
