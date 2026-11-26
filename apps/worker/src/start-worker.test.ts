import { randomUUID } from "node:crypto";
import {
  createOrganization,
  createWorkingGroup,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { createQueueMail, ensureMailQueue } from "@padvinder/mail";
import nodemailer from "nodemailer";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { WorkerEnv } from "./env";
import type { Logger } from "./logger";
import { startWorker } from "./start-worker";

const mailSettings = {
  PUBLIC_ORIGIN: "http://localhost:4101",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: 54325,
  MAIL_FROM: "PadVinder <noreply@padvinder.test>",
};

function testLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

test("logs and rejects when the database is unreachable", async () => {
  const logger = testLogger();
  await expect(
    startWorker(
      {
        DATABASE_URL: "postgres://padvinder:padvinder@127.0.0.1:1/none",
        LOG_LEVEL: "info",
        ...mailSettings,
      },
      logger,
    ),
  ).rejects.toThrow();
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/start/i), expect.anything());
});

test("with MAIL_SUBJECT_PREFIX the worker's mails start with it", async () => {
  // The SMTP mailer made from the worker's settings, without a mail server behind it.
  const sendMail = vi.fn<(message: { to: string; subject: string }) => Promise<void>>();
  sendMail.mockResolvedValue(undefined);
  const close = vi.fn();
  const createTransport = vi
    .spyOn(nodemailer, "createTransport")
    .mockReturnValue({ sendMail, close } as never);

  const system = { kind: "system" } as const;
  const organizationId = (
    await createOrganization(
      t!.db,
      { name: "Prefix Org", adminEmail: "prefix-admin@example.test" },
      system,
    )
  ).id;
  const workingGroupId = (
    await createWorkingGroup(
      t!.db,
      {
        organizationId,
        name: "Noord",
        city: "Voorbeeldstad",
        coordinatorEmail: "prefix-coordinator@example.test",
      },
      system,
    )
  ).id;
  const email = `${randomUUID()}@example.test`;
  const [user] = await t!.db
    .insert(users)
    .values({ name: "Noor", email, emailVerified: true })
    .returning({ id: users.id });
  const [membership] = await t!.db
    .insert(workingGroupMemberships)
    .values({ userId: user!.id, workingGroupId })
    .returning({ id: workingGroupMemberships.id });

  const env: WorkerEnv = {
    DATABASE_URL: t!.url,
    LOG_LEVEL: "info",
    ...mailSettings,
    MAIL_SUBJECT_PREFIX: "[STAGING]",
  };
  const worker = await startWorker(env, testLogger());
  const sender = new PgBoss(t!.url);
  try {
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.test", port: 54325 }),
    );
    await sender.start();
    await ensureMailQueue(sender);
    const queueMail = createQueueMail(sender);
    await t!.db.transaction(async (tx) => {
      await queueMail(tx, {
        kind: "added-to-working-group",
        membershipId: membership!.id,
        byUserId: user!.id,
      });
    });
    await expect.poll(() => sendMail.mock.calls.length, { timeout: 10_000 }).toBe(1);
    const [message] = sendMail.mock.calls[0]!;
    expect(message.to).toBe(email);
    expect(message.subject).toBe("[STAGING] Je bent toegevoegd aan werkgroep Noord");
  } finally {
    await sender.stop({ graceful: true, timeout: 5_000 });
    await worker.stop();
    createTransport.mockRestore();
  }
  // Stopping the worker closes the mailer.
  expect(close).toHaveBeenCalled();
}, 30_000);
