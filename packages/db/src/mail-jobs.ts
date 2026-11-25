import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbTransaction } from "./client";
import {
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

const id = z.uuid();

/**
 * A job in the mail queue: the kind of mail and IDs, nothing else. The address and the names are
 * loaded when the mail is sent (`loadMailJobData`), so the queue holds no personal data. Strict:
 * a key that is not listed here (a name, an address) is refused.
 */
export const mailJobSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("added-to-working-group"), membershipId: id, byUserId: id }),
  z.strictObject({ kind: z.literal("first-coordinator"), membershipId: id, byUserId: id }),
  z.strictObject({
    kind: z.literal("invited-to-working-group"),
    userId: id,
    workingGroupId: id,
    byUserId: id,
  }),
  z.strictObject({ kind: z.literal("organization-admin"), userId: id, organizationId: id }),
]);

export type MailJob = z.infer<typeof mailJobSchema>;

/**
 * Queues one mail in the transaction that makes the change, so the job is committed or rolled
 * back with it. Like `notify`, it takes the transaction, never the plain database.
 */
export type QueueMail = (tx: DbTransaction, job: MailJob) => Promise<void>;

/** What the mail texts need, loaded when the mail is sent. */
export type MailJobData =
  | {
      kind: "added-to-working-group" | "first-coordinator";
      to: string;
      recipientName: string;
      /** Null when that account is gone, deleted or has no name. */
      byName: string | null;
      workingGroupName: string;
      contactEmail: string | null;
    }
  | {
      kind: "invited-to-working-group";
      to: string;
      recipientName: string;
      byName: string | null;
      workingGroupName: string;
    }
  | {
      kind: "organization-admin";
      to: string;
      recipientName: string;
      organizationName: string;
    };

/** The name of an account that still exists and has one, else null. */
async function loadByName(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  const name = row?.name.trim() ?? "";
  return name === "" ? null : name;
}

/**
 * Loads the receiver's address and the names for a queued mail. Null, and the mail is dropped,
 * when the receiver's account is gone or deleted, or when what the mail is about is gone: the
 * membership, the admin row, or the working group of an invitation.
 */
export async function loadMailJobData(db: Db, job: MailJob): Promise<MailJobData | null> {
  switch (job.kind) {
    case "added-to-working-group":
    case "first-coordinator": {
      const [row] = await db
        .select({
          to: users.email,
          recipientName: users.name,
          workingGroupName: workingGroups.name,
          contactEmail: organizations.contactEmail,
        })
        .from(workingGroupMemberships)
        .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
        .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
        .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
        .where(and(eq(workingGroupMemberships.id, job.membershipId), isNull(users.deletedAt)));
      if (!row) return null;
      return { kind: job.kind, ...row, byName: await loadByName(db, job.byUserId) };
    }
    case "invited-to-working-group": {
      const [receiver] = await db
        .select({ to: users.email, recipientName: users.name })
        .from(users)
        .where(and(eq(users.id, job.userId), isNull(users.deletedAt)));
      const [group] = await db
        .select({ workingGroupName: workingGroups.name })
        .from(workingGroups)
        .where(eq(workingGroups.id, job.workingGroupId));
      if (!receiver || !group) return null;
      return {
        kind: job.kind,
        ...receiver,
        byName: await loadByName(db, job.byUserId),
        workingGroupName: group.workingGroupName,
      };
    }
    case "organization-admin": {
      const [row] = await db
        .select({
          to: users.email,
          recipientName: users.name,
          organizationName: organizations.name,
        })
        .from(organizationAdmins)
        .innerJoin(users, eq(users.id, organizationAdmins.userId))
        .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
        .where(
          and(
            eq(organizationAdmins.userId, job.userId),
            eq(organizationAdmins.organizationId, job.organizationId),
            isNull(users.deletedAt),
          ),
        );
      if (!row) return null;
      return { kind: job.kind, ...row };
    }
  }
}
