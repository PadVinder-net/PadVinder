import { randomUUID } from "node:crypto";
import {
  createOrganization,
  createWorkingGroup,
  users,
  workingGroupMemberships,
  type MailJob,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import {
  createMemoryMailer,
  createQueueMail,
  ensureMailQueue,
  MAIL_QUEUE,
  MAIL_QUEUE_OPTIONS,
  type Mail,
  type Mailer,
} from "@padvinder/mail";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Logger } from "../logger";
import { registerMailJob } from "./mail";

const system = { kind: "system" } as const;
const publicOrigin = "http://localhost:4101";
/** pg-boss looks for new jobs every 2 seconds, and a retry waits for that too. */
const TEST_TIMEOUT_MS = 30_000;
/** Pauses of a second between tries (retryDelayMax caps the backoff), not minutes. */
const quickRetries = { ...MAIL_QUEUE_OPTIONS, retryLimit: 2, retryDelay: 1, retryDelayMax: 1 };

let t: TestDatabase | undefined;
/** Queues jobs, as the API does; it works no queue itself. */
let sender: PgBoss;
let groupId = "";
let adderId = "";
beforeAll(async () => {
  t = await createTestDatabase();
  sender = new PgBoss(t.url);
  sender.on("error", (error) => console.error(error));
  await sender.start();
  await ensureMailQueue(sender, quickRetries);
  const organizationId = (
    await createOrganization(
      t.db,
      { name: "Worker Mail Org", adminEmail: "worker-mail-admin@example.test" },
      system,
    )
  ).id;
  groupId = (
    await createWorkingGroup(
      t.db,
      {
        organizationId,
        name: "Noord",
        city: "Voorbeeldstad",
        coordinatorEmail: "worker-mail-coordinator@example.test",
      },
      system,
    )
  ).id;
  adderId = (await addUser("Kees Coördinator")).id;
});
afterAll(async () => {
  await sender?.stop({ graceful: true, timeout: 5_000 });
  await t?.drop();
});

function testLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Everything that was logged, as one text. */
function loggedText(logger: Logger): string {
  return JSON.stringify(Object.values(logger).map((fn) => vi.mocked(fn).mock.calls));
}

async function addUser(name: string): Promise<{ id: string; email: string; name: string }> {
  const email = `${randomUUID()}@example.test`;
  const [user] = await t!.db
    .insert(users)
    .values({ name, email, emailVerified: true })
    .returning({ id: users.id });
  return { id: user!.id, email, name };
}

/** A person added to the group, and the job the API would queue for them. */
async function addedPerson(name = "Noor Nieuw") {
  const person = await addUser(name);
  const [membership] = await t!.db
    .insert(workingGroupMemberships)
    .values({ userId: person.id, workingGroupId: groupId })
    .returning({ id: workingGroupMemberships.id });
  const job: MailJob = {
    kind: "added-to-working-group",
    membershipId: membership!.id,
    byUserId: adderId,
  };
  return { ...person, membershipId: membership!.id, job };
}

async function queue(job: MailJob): Promise<string> {
  const queueMail = createQueueMail(sender);
  await t!.db.transaction(async (tx) => {
    await queueMail(tx, job);
  });
  const [found] = await sender.findJobs<MailJob>(MAIL_QUEUE, { data: job });
  return found!.id;
}

async function jobState(id: string) {
  return (await sender.getJobById(MAIL_QUEUE, id))?.state;
}

/** Starts a worker that works the mail queue; stop it at the end of the test. */
async function startMailWorker(deps: {
  mailer: Mailer;
  logger?: Logger;
  pauseMs?: number;
  queueOptions?: typeof MAIL_QUEUE_OPTIONS;
}) {
  const boss = new PgBoss(t!.url);
  boss.on("error", (error) => console.error(error));
  await boss.start();
  await registerMailJob(boss, {
    db: t!.db,
    publicOrigin,
    logger: deps.logger ?? testLogger(),
    mailer: deps.mailer,
    pauseMs: deps.pauseMs ?? 0,
    queueOptions: deps.queueOptions ?? quickRetries,
  });
  return { stop: () => boss.stop({ graceful: true, timeout: 5_000 }) };
}

/** Fails every mail to the given addresses, with an error that names the address. */
function failingFor(addresses: string[]) {
  const inner = createMemoryMailer();
  let fail = new Set(addresses);
  const attempts: Mail[] = [];
  return {
    sent: inner.sent,
    attempts,
    heal() {
      fail = new Set();
    },
    async send(mail: Mail) {
      attempts.push(mail);
      if (fail.has(mail.to)) {
        throw Object.assign(new Error(`550 <${mail.to}> mailbox unavailable`), {
          code: "EENVELOPE",
          responseCode: 550,
          command: "RCPT TO",
        });
      }
      await inner.send(mail);
    },
  } satisfies Mailer & Record<string, unknown>;
}

test(
  "a queued job becomes one mail to the added person",
  async () => {
    const mailer = createMemoryMailer();
    const worker = await startMailWorker({ mailer });
    try {
      const person = await addedPerson();
      const id = await queue(person.job);
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("completed");
      expect(mailer.sent).toHaveLength(1);
      const [mail] = mailer.sent;
      expect(mail).toMatchObject({ to: person.email, kind: "added-to-working-group" });
      expect(mail!.subject).toBe("Je bent toegevoegd aan werkgroep Noord");
      expect(mail!.text).toContain("Hallo Noor Nieuw,");
      expect(mail!.text).toContain(`${publicOrigin}/app/`);
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "two jobs are sent one after the other, with the pause between them",
  async () => {
    const sentAt: number[] = [];
    const inner = createMemoryMailer();
    const mailer: Mailer = {
      async send(mail) {
        sentAt.push(Date.now());
        await inner.send(mail);
      },
    };
    const first = await addedPerson("Eerste");
    const second = await addedPerson("Tweede");
    const firstId = await queue(first.job);
    const secondId = await queue(second.job);
    const worker = await startMailWorker({ mailer, pauseMs: 2_500 });
    try {
      await expect.poll(() => jobState(secondId), { timeout: 15_000 }).toBe("completed");
      expect(await jobState(firstId)).toBe("completed");
      expect(inner.sent.map((mail) => mail.to)).toEqual([first.email, second.email]);
      // pg-boss alone would fetch the second job about 2 seconds after the first, so 2.5 s is the
      // pause's doing.
      expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(2_500);
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a job whose membership is gone is dropped: no mail, no retry",
  async () => {
    const mailer = createMemoryMailer();
    const logger = testLogger();
    const worker = await startMailWorker({ mailer, logger });
    try {
      const person = await addedPerson();
      await t!.db
        .delete(workingGroupMemberships)
        .where(eq(workingGroupMemberships.id, person.membershipId));
      const id = await queue(person.job);
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("completed");
      expect(mailer.sent).toEqual([]);
      expect((await sender.getJobById(MAIL_QUEUE, id))?.retryCount).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/dropped/i), {
        kind: "added-to-working-group",
      });
      expect(loggedText(logger)).not.toContain(person.email);
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a job that is not a valid mail job is dropped without a retry",
  async () => {
    const mailer = createMemoryMailer();
    const logger = testLogger();
    const worker = await startMailWorker({ mailer, logger });
    try {
      const id = (await sender.send(MAIL_QUEUE, { kind: "added-to-working-group", to: "x" }))!;
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("completed");
      expect(mailer.sent).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/not a valid mail job/i));
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a failing mailer is tried again and the mail goes out once the mailer works",
  async () => {
    const person = await addedPerson();
    const mailer = failingFor([person.email]);
    const logger = testLogger();
    const worker = await startMailWorker({ mailer, logger });
    try {
      const id = await queue(person.job);
      await expect.poll(() => mailer.attempts.length, { timeout: 10_000 }).toBe(1);
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("retry");
      expect(mailer.sent).toEqual([]);
      mailer.heal();
      await expect.poll(() => jobState(id), { timeout: 15_000 }).toBe("completed");
      expect(mailer.sent.map((mail) => mail.to)).toEqual([person.email]);
      expect(mailer.attempts).toHaveLength(2);
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a job that keeps failing ends as failed, and the worker handles the next job",
  async () => {
    const failing = await addedPerson("Faal Persoon");
    const next = await addedPerson("Volgende Persoon");
    const mailer = failingFor([failing.email]);
    const logger = testLogger();
    const worker = await startMailWorker({ mailer, logger });
    try {
      const failingId = await queue(failing.job);
      const nextId = await queue(next.job);
      // The next job goes out while the failing one waits for its next try.
      await expect.poll(() => jobState(nextId), { timeout: 10_000 }).toBe("completed");
      expect(mailer.sent.map((mail) => mail.to)).toEqual([next.email]);
      await expect.poll(() => jobState(failingId), { timeout: 20_000 }).toBe("failed");
      // retryLimit 2: the first try and two more.
      expect(mailer.attempts.filter((mail) => mail.to === failing.email)).toHaveLength(3);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/dropped after the last try/i),
        expect.objectContaining({ kind: "added-to-working-group" }),
      );
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "the log of a failure, and the failed job, hold the kind and no address or name",
  async () => {
    const person = await addedPerson("Geheime Naam");
    const mailer = failingFor([person.email]);
    const logger = testLogger();
    const worker = await startMailWorker({
      mailer,
      logger,
      queueOptions: { ...quickRetries, retryLimit: 0 },
    });
    try {
      // The worker made the queue's retryLimit 0: the first failure is the last.
      const id = await queue(person.job);
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("failed");
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/dropped/i), {
        kind: "added-to-working-group",
        error: { type: "Error", code: "EENVELOPE", responseCode: 550, command: "RCPT TO" },
      });
      const logged = loggedText(logger);
      expect(logged).toContain("added-to-working-group");
      // pg-boss keeps the thrown error with the job: the queue holds no address either.
      const { rows } = await t!.pool.query<{ output: unknown }>(
        "select output from pgboss.job where id = $1",
        [id],
      );
      const output = JSON.stringify(rows[0]!.output);
      expect(output).toContain("added-to-working-group");
      for (const secret of [person.email, person.name, "Kees Coördinator", "@example.test"]) {
        expect(logged).not.toContain(secret);
        expect(output).not.toContain(secret);
      }
    } finally {
      await worker.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a job that was queued while the worker was stopped is sent after it starts",
  async () => {
    const mailer = createMemoryMailer();
    const before = await startMailWorker({ mailer });
    await before.stop();
    const person = await addedPerson();
    const id = await queue(person.job);
    // Nobody works the queue: the job waits.
    expect(await jobState(id)).toBe("created");
    const after = await startMailWorker({ mailer });
    try {
      await expect.poll(() => jobState(id), { timeout: 10_000 }).toBe("completed");
      expect(mailer.sent.map((mail) => mail.to)).toEqual([person.email]);
    } finally {
      await after.stop();
    }
  },
  TEST_TIMEOUT_MS,
);
