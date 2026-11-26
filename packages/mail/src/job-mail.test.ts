import type { MailJobData } from "@padvinder/db";
import { expect, test } from "vitest";
import { buildMailForJob } from "./job-mail";

const origins = { publicOrigin: "https://padvinder.test" };

test.each<{ data: MailJobData; subject: string; link: string }>([
  {
    data: {
      kind: "added-to-working-group",
      to: "noor@example.test",
      recipientName: "Noor",
      byName: "Carla",
      workingGroupName: "Noord",
      contactEmail: "contact@example.test",
    },
    subject: "Je bent toegevoegd aan werkgroep Noord",
    link: "https://padvinder.test/app/",
  },
  {
    data: {
      kind: "first-coordinator",
      to: "noor@example.test",
      recipientName: "Noor",
      byName: null,
      workingGroupName: "Noord",
      contactEmail: null,
    },
    subject: "Je bent toegevoegd aan werkgroep Noord",
    link: "https://padvinder.test/",
  },
  {
    data: {
      kind: "invited-to-working-group",
      to: "noor@example.test",
      recipientName: "Noor",
      byName: "Carla",
      workingGroupName: "Noord",
    },
    subject: "Carla wil je toevoegen aan werkgroep Noord",
    link: "https://padvinder.test/app/",
  },
  {
    data: {
      kind: "organization-admin",
      to: "noor@example.test",
      recipientName: "Noor",
      organizationName: "Org",
    },
    subject: "Je bent beheerder van Org",
    link: "https://padvinder.test/",
  },
])(
  "$data.kind picks its mail, with the link built from the public origin",
  ({ data, subject, link }) => {
    const mail = buildMailForJob(data, origins);
    expect(mail.kind).toBe(data.kind);
    expect(mail.to).toBe("noor@example.test");
    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain(`\n${link}`);
    expect(mail.text.endsWith(link) || mail.text.includes(`${link}\n\n`)).toBe(true);
  },
);

test("the first coordinator's mail has the coordinator sentence", () => {
  const mail = buildMailForJob(
    {
      kind: "first-coordinator",
      to: "noor@example.test",
      recipientName: "Noor",
      byName: "Carla",
      workingGroupName: "Noord",
      contactEmail: null,
    },
    origins,
  );
  expect(mail.text).toContain("Carla heeft je coördinator gemaakt van werkgroep Noord");
});

test("the passkey mails are picked by kind, without a link", () => {
  const added = buildMailForJob(
    {
      kind: "passkey-added",
      to: "noor@example.test",
      recipientName: "Noor",
      addedAt: new Date("2026-11-26T13:05:00Z"),
    },
    origins,
  );
  expect(added.kind).toBe("passkey-added");
  expect(added.text).not.toContain("padvinder.test");
  const removed = buildMailForJob(
    {
      kind: "passkeys-removed",
      to: "noor@example.test",
      recipientName: "Noor",
      byOther: true,
      byName: "Carla",
      remaining: 0,
    },
    origins,
  );
  expect(removed.kind).toBe("passkeys-removed");
  expect(removed.subject).toBe("Je toegangssleutels zijn verwijderd");
  expect(removed.text).not.toContain("padvinder.test");
});
