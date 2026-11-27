import { greeting, singleLine } from "./greeting";
import { escapeHtml } from "./html";
import type { Mail } from "./mailer";

const ADVICE =
  "Deed je dat zelf? Dan hoef je niets te doen. Deed je het niet? Neem dan meteen contact op met een hoofdbeheerder of met een andere beheerder van je organisatie.";

const dateFormat = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A mail without a link: the greeting, an empty line, then the paragraphs. */
function build(
  kind: string,
  to: string,
  recipientName: string,
  subject: string,
  paragraphs: string[],
): Mail {
  const hello = greeting(recipientName);
  return {
    to,
    subject,
    text: [hello, ...paragraphs].join("\n\n"),
    html: [hello, ...paragraphs].map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n"),
    kind,
  };
}

/** To the person after a passkey was added to their account; the time is Amsterdam time. */
export function buildPasskeyAddedMail(input: {
  to: string;
  recipientName: string;
  addedAt: Date;
}): Mail {
  const date = dateFormat.format(input.addedAt);
  const time = timeFormat.format(input.addedAt);
  return build(
    "passkey-added",
    input.to,
    input.recipientName,
    "Er is een toegangssleutel toegevoegd aan je account",
    [
      `Er is op ${date} om ${time} een toegangssleutel toegevoegd aan je PadVinder-account. ${ADVICE}`,
    ],
  );
}

/** To the person after passkeys were removed: by someone else, by themself with none or some left. */
export function buildPasskeysRemovedMail(input: {
  to: string;
  recipientName: string;
  byOther: boolean;
  byName: string | null;
  remaining: number;
}): Mail {
  const again = "Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder.";
  if (input.byOther) {
    const by = singleLine(input.byName ?? "") || "Een beheerder";
    return build(
      "passkeys-removed",
      input.to,
      input.recipientName,
      "Je toegangssleutels zijn verwijderd",
      [`${by} heeft je toegangssleutels voor PadVinder verwijderd. ${again}`],
    );
  }
  if (input.remaining > 0) {
    return build(
      "passkeys-removed",
      input.to,
      input.recipientName,
      "Er is een toegangssleutel verwijderd van je account",
      [`Er is een toegangssleutel verwijderd van je account. ${ADVICE}`],
    );
  }
  return build(
    "passkeys-removed",
    input.to,
    input.recipientName,
    "Je toegangssleutels zijn verwijderd",
    [
      `Je toegangssleutels voor PadVinder zijn verwijderd. ${again} Deed je dat niet zelf? Neem dan meteen contact op met een hoofdbeheerder of met een andere beheerder van je organisatie.`,
    ],
  );
}
