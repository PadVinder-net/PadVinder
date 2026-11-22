import type { WorkingGroupSummary } from "@padvinder/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { organizations, workingGroups } from "./schema";

/**
 * Every active working group of every organization, for the list a new volunteer picks from.
 * This is the one list that crosses organizations. Sorted by name, then organization, in Dutch
 * order.
 */
export async function listWorkingGroupDirectory(db: Db): Promise<WorkingGroupSummary[]> {
  const rows = await db
    .select({
      id: workingGroups.id,
      name: workingGroups.name,
      city: workingGroups.city,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(workingGroups)
    .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
    .where(eq(workingGroups.active, true))
    .orderBy(
      asc(sql`${workingGroups.name} collate "nl-NL-x-icu"`),
      asc(sql`${organizations.name} collate "nl-NL-x-icu"`),
      asc(workingGroups.id),
    );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    organization: { id: row.organizationId, name: row.organizationName },
  }));
}

export async function getWorkingGroup(
  db: Db,
  workingGroupId: string,
): Promise<{
  workingGroupId: string;
  organizationId: string;
  name: string;
  active: boolean;
} | null> {
  const [row] = await db
    .select({
      workingGroupId: workingGroups.id,
      organizationId: workingGroups.organizationId,
      name: workingGroups.name,
      active: workingGroups.active,
    })
    .from(workingGroups)
    .where(eq(workingGroups.id, workingGroupId));
  return row ?? null;
}
