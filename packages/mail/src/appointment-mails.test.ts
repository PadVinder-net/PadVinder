import { expect, test } from "vitest";
import {
  buildAddedMail,
  buildFirstCoordinatorMail,
  buildInvitedMail,
  buildOrganizationAdminMail,
} from "./appointment-mails";
import type { Mail } from "./mailer";

const appUrl = "https://padvinder.test/app/";
const portalUrl = "https://padvinder.test/";
const to = "noor@example.test";
const recipientName = "Noor";
const contactEmail = "contact@example.test";

/** The subject is the first line of the block, the text part the greeting and the rest. */
function expectMail(mail: Mail, block: string) {
  const [subject, empty, ...body] = block.split("\n");
  expect(empty).toBe("");
  expect(mail.to).toBe(to);
  expect(mail.subject).toBe(subject);
  expect(mail.text).toBe(`Hallo Noor,\n\n${body.join("\n")}`);
}

test.each([
  {
    name: "added, with byName and a contact address",
    mail: () =>
      buildAddedMail({
        to,
        recipientName,
        byName: "Carla",
        workingGroupName: "Noord",
        contactEmail,
        appUrl,
      }),
    kind: "added-to-working-group",
    block: `Je bent toegevoegd aan werkgroep Noord

Carla heeft je toegevoegd aan werkgroep Noord in PadVinder.

Open PadVinder en log in met dit e-mailadres:
${appUrl}

Klopt dit niet? Neem contact op met contact@example.test.`,
  },
  {
    name: "added, without byName",
    mail: () =>
      buildAddedMail({
        to,
        recipientName,
        byName: null,
        workingGroupName: "Noord",
        contactEmail,
        appUrl,
      }),
    kind: "added-to-working-group",
    block: `Je bent toegevoegd aan werkgroep Noord

Je bent toegevoegd aan werkgroep Noord in PadVinder.

Open PadVinder en log in met dit e-mailadres:
${appUrl}

Klopt dit niet? Neem contact op met contact@example.test.`,
  },
  {
    name: "added, without a contact address",
    mail: () =>
      buildAddedMail({
        to,
        recipientName,
        byName: "Carla",
        workingGroupName: "Noord",
        contactEmail: null,
        appUrl,
      }),
    kind: "added-to-working-group",
    block: `Je bent toegevoegd aan werkgroep Noord

Carla heeft je toegevoegd aan werkgroep Noord in PadVinder.

Open PadVinder en log in met dit e-mailadres:
${appUrl}`,
  },
  {
    name: "first coordinator, with byName and a contact address",
    mail: () =>
      buildFirstCoordinatorMail({
        to,
        recipientName,
        byName: "Carla",
        workingGroupName: "Noord",
        contactEmail,
        portalUrl,
      }),
    kind: "first-coordinator",
    block: `Je bent toegevoegd aan werkgroep Noord

Carla heeft je coördinator gemaakt van werkgroep Noord in PadVinder.

Open het portaal en log in met dit e-mailadres:
${portalUrl}

Klopt dit niet? Neem contact op met contact@example.test.`,
  },
  {
    name: "first coordinator, without byName and without a contact address",
    mail: () =>
      buildFirstCoordinatorMail({
        to,
        recipientName,
        byName: null,
        workingGroupName: "Noord",
        contactEmail: null,
        portalUrl,
      }),
    kind: "first-coordinator",
    block: `Je bent toegevoegd aan werkgroep Noord

Je bent coördinator van werkgroep Noord in PadVinder.

Open het portaal en log in met dit e-mailadres:
${portalUrl}`,
  },
  {
    name: "invited, with byName",
    mail: () =>
      buildInvitedMail({ to, recipientName, byName: "Carla", workingGroupName: "Noord", appUrl }),
    kind: "invited-to-working-group",
    block: `Carla wil je toevoegen aan werkgroep Noord

Carla wil je toevoegen aan werkgroep Noord in PadVinder.

Wil je dat? Open PadVinder, ga naar Meer > Profiel en kies "Meld je aan bij nog een werkgroep".
${appUrl}

Wil je dat niet? Dan hoef je niets te doen.`,
  },
  {
    name: "invited, without byName",
    mail: () =>
      buildInvitedMail({ to, recipientName, byName: null, workingGroupName: "Noord", appUrl }),
    kind: "invited-to-working-group",
    block: `Iemand wil je toevoegen aan werkgroep Noord

Iemand wil je toevoegen aan werkgroep Noord in PadVinder.

Wil je dat? Open PadVinder, ga naar Meer > Profiel en kies "Meld je aan bij nog een werkgroep".
${appUrl}

Wil je dat niet? Dan hoef je niets te doen.`,
  },
  {
    name: "organization admin",
    mail: () =>
      buildOrganizationAdminMail({
        to,
        recipientName,
        organizationName: "Paddentrek Voorbeeldstad",
        portalUrl,
      }),
    kind: "organization-admin",
    block: `Je bent beheerder van Paddentrek Voorbeeldstad

Je bent beheerder van Paddentrek Voorbeeldstad in PadVinder.

Open het portaal en log in met dit e-mailadres:
${portalUrl}`,
  },
])("$name", ({ mail, kind, block }) => {
  const built = mail();
  expectMail(built, block);
  expect(built.kind).toBe(kind);
  // The HTML part has the same greeting and one link, to the same address as the text part.
  expect(built.html.startsWith("<p>Hallo Noor,</p>\n<p>")).toBe(true);
  expect(built.html.match(/<a /g)).toHaveLength(1);
  const url = kind === "first-coordinator" || kind === "organization-admin" ? portalUrl : appUrl;
  expect(built.html).toContain(`<a href="${url}">${url}</a>`);
});

test("a name that is only spaces counts as no name", () => {
  const added = buildAddedMail({
    to,
    recipientName,
    byName: " \n ",
    workingGroupName: "Noord",
    contactEmail: null,
    appUrl,
  });
  expect(added.text.split("\n\n")[1]).toBe("Je bent toegevoegd aan werkgroep Noord in PadVinder.");
  const invited = buildInvitedMail({
    to,
    recipientName,
    byName: "",
    workingGroupName: "Noord",
    appUrl,
  });
  expect(invited.subject).toBe("Iemand wil je toevoegen aan werkgroep Noord");
});

test("without a name the greeting is Hallo,", () => {
  const mail = buildOrganizationAdminMail({
    to,
    recipientName: "",
    organizationName: "Org",
    portalUrl,
  });
  expect(mail.text.startsWith("Hallo,\n\n")).toBe(true);
  expect(mail.html.startsWith("<p>Hallo,</p>\n<p>")).toBe(true);
});

test("names and addresses are escaped in the HTML part and put on one line in the subject", () => {
  const byName = "<i>Carla</i>\nBcc: x@example.test";
  const workingGroupName = "Noord & Zuid";
  const mails = [
    buildAddedMail({
      to,
      recipientName: "<b>Noor</b>",
      byName,
      workingGroupName,
      contactEmail: `"a&b"@example.test`,
      appUrl,
    }),
    buildFirstCoordinatorMail({
      to,
      recipientName: "<b>Noor</b>",
      byName,
      workingGroupName,
      contactEmail: `"a&b"@example.test`,
      portalUrl,
    }),
    buildInvitedMail({ to, recipientName: "<b>Noor</b>", byName, workingGroupName, appUrl }),
    buildOrganizationAdminMail({
      to,
      recipientName: "<b>Noor</b>",
      organizationName: "<i>Org</i>\nSubject: y",
      portalUrl,
    }),
  ];
  for (const mail of mails) {
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toMatch(/<(b|i)>/);
    expect(mail.html).toContain("<p>Hallo &lt;b&gt;Noor&lt;/b&gt;,</p>");
    // Every line of the text part starts where a paragraph or the link starts: no name breaks it.
    expect(mail.text).not.toMatch(/\nBcc:|\nSubject:/);
  }
  const [added, coordinator, invited, admin] = mails;
  expect(added!.subject).toBe("Je bent toegevoegd aan werkgroep Noord & Zuid");
  expect(added!.html).toContain(
    "&lt;i&gt;Carla&lt;/i&gt; Bcc: x@example.test heeft je toegevoegd aan werkgroep Noord &amp; Zuid in PadVinder.",
  );
  expect(added!.html).toContain("&quot;a&amp;b&quot;@example.test");
  expect(coordinator!.html).toContain("Noord &amp; Zuid");
  expect(invited!.subject).toBe(
    "<i>Carla</i> Bcc: x@example.test wil je toevoegen aan werkgroep Noord & Zuid",
  );
  expect(invited!.html).toContain("&lt;i&gt;Carla&lt;/i&gt; Bcc: x@example.test wil je toevoegen");
  expect(invited!.html).toContain("Meer &gt; Profiel en kies &quot;Meld je aan");
  expect(admin!.subject).toBe("Je bent beheerder van <i>Org</i> Subject: y");
  expect(admin!.html).toContain("&lt;i&gt;Org&lt;/i&gt; Subject: y");
});
