import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { users } from "./schema";

export type UserProfile = { id: string; name: string; email: string; phone: string | null };

const profileColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
};

export async function getUserProfile(db: Db, userId: string): Promise<UserProfile | null> {
  const [row] = await db.select(profileColumns).from(users).where(eq(users.id, userId));
  return row ?? null;
}

/** Changes only the keys that are present in the patch. `null` when the user does not exist. */
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
      ? await db.select(profileColumns).from(users).where(eq(users.id, userId))
      : await db
          .update(users)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning(profileColumns);
  return row ?? null;
}
