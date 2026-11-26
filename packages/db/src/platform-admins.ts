import type { PlatformAdmin } from "@padvinder/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { users } from "./schema";
import { userHasPasskey } from "./passkeys";
import { userHasLoggedIn } from "./users";

/**
 * Every platform admin, sorted by name in Dutch order, then by address; deleted accounts left
 * out. Not scoped: the caller authorizes. `hasLoggedIn` reads `last_login_at`, as every list of
 * people does; the rule on the last platform admin reads `email_verified` (`hasOtherPlatformAdmin`).
 */
export async function listPlatformAdmins(db: Db): Promise<PlatformAdmin[]> {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      hasLoggedIn: userHasLoggedIn,
      hasPasskey: userHasPasskey,
    })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), isNull(users.deletedAt)))
    .orderBy(asc(sql`${users.name} collate "nl-NL-x-icu"`), asc(users.email));
}
