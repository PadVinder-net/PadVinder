import { expect, test } from "vitest";
import { buildPasskeyAddedMail, buildPasskeysRemovedMail } from "./passkey-mails";

const to = "noor@example.test";

test("the added mail names the date and time in Europe/Amsterdam", () => {
  const winter = buildPasskeyAddedMail({
    to,
    recipientName: "Noor",
    addedAt: new Date("2026-11-26T13:05:00Z"),
  });
  expect(winter.subject).toBe("Er is een toegangssleutel toegevoegd aan je account");
  expect(winter.text).toContain(
    "Er is op 26 november 2026 om 14:05 een toegangssleutel toegevoegd aan je PadVinder-account. Deed je dat zelf? Dan hoef je niets te doen.",
  );
  expect(winter.text).toContain("met een hoofdbeheerder of met een andere beheerder");
  const summer = buildPasskeyAddedMail({
    to,
    recipientName: "Noor",
    addedAt: new Date("2026-07-01T22:30:00Z"),
  });
  expect(summer.text).toContain("op 2 juli 2026 om 00:30");
});

test("each mail starts with the greeting and holds no link, no ID and no credential material", () => {
  const mails = [
    buildPasskeyAddedMail({ to, recipientName: "Noor", addedAt: new Date() }),
    buildPasskeysRemovedMail({
      to,
      recipientName: "Noor",
      byOther: true,
      byName: "Carla",
      remaining: 0,
    }),
    buildPasskeysRemovedMail({
      to,
      recipientName: "Noor",
      byOther: false,
      byName: null,
      remaining: 0,
    }),
    buildPasskeysRemovedMail({
      to,
      recipientName: "Noor",
      byOther: false,
      byName: null,
      remaining: 2,
    }),
  ];
  for (const mail of mails) {
    expect(mail.text.startsWith("Hallo Noor,\n\n")).toBe(true);
    expect(mail.html.startsWith("<p>Hallo Noor,</p>")).toBe(true);
    expect(mail.text + mail.html).not.toMatch(/https?:|href|[0-9a-f]{8}-[0-9a-f]{4}/i);
  }
});

test("removed by someone else names them; without a name it says Een beheerder", () => {
  const named = buildPasskeysRemovedMail({
    to,
    recipientName: "Noor",
    byOther: true,
    byName: "Carla",
    remaining: 0,
  });
  expect(named.subject).toBe("Je toegangssleutels zijn verwijderd");
  expect(named.text).toContain(
    "Carla heeft je toegangssleutels voor PadVinder verwijderd. Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder.",
  );
  for (const byName of [null, "  "]) {
    const mail = buildPasskeysRemovedMail({
      to,
      recipientName: "Noor",
      byOther: true,
      byName,
      remaining: 0,
    });
    expect(mail.text).toContain(
      "Een beheerder heeft je toegangssleutels voor PadVinder verwijderd.",
    );
  }
});

test("removed by the person: the text differs with none and with some left", () => {
  const none = buildPasskeysRemovedMail({
    to,
    recipientName: "Noor",
    byOther: false,
    byName: null,
    remaining: 0,
  });
  expect(none.subject).toBe("Je toegangssleutels zijn verwijderd");
  expect(none.text).toContain(
    "Je toegangssleutels voor PadVinder zijn verwijderd. Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder. Deed je dat niet zelf? Neem dan meteen contact op",
  );
  const some = buildPasskeysRemovedMail({
    to,
    recipientName: "Noor",
    byOther: false,
    byName: null,
    remaining: 1,
  });
  expect(some.subject).toBe("Er is een toegangssleutel verwijderd van je account");
  expect(some.text).toContain(
    "Er is een toegangssleutel verwijderd van je account. Deed je dat zelf? Dan hoef je niets te doen.",
  );
});

test("markup and a line break in a name do not break the mail", () => {
  const mail = buildPasskeysRemovedMail({
    to,
    recipientName: "<b>Noor</b>\nX",
    byOther: true,
    byName: "<i>Carla</i>\r\nBcc: x@example.test",
    remaining: 0,
  });
  expect(mail.html).not.toContain("<b>");
  expect(mail.html).not.toContain("<i>");
  expect(mail.html).toContain("&lt;i&gt;Carla&lt;/i&gt; Bcc: x@example.test heeft");
  expect(mail.text.split("\n")[0]).toBe("Hallo <b>Noor</b> X,");
  expect(mail.text).toContain("<i>Carla</i> Bcc: x@example.test heeft");
});
