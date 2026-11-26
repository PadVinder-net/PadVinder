import { greeting, singleLine } from "./greeting";
import { escapeHtml } from "./html";
import type { Mail } from "./mailer";

/** A paragraph of text, or a sentence with the link on the next line. */
type Block = string | { lead: string; url: string };

/** The greeting, then the blocks, each block a paragraph separated by an empty line. */
function compose(input: {
  kind: string;
  to: string;
  recipientName: string;
  subject: string;
  blocks: Block[];
}): Mail {
  const blocks: Block[] = [greeting(input.recipientName), ...input.blocks];
  const text = blocks
    .map((block) => (typeof block === "string" ? block : `${block.lead}\n${block.url}`))
    .join("\n\n");
  const html = blocks
    .map((block) => {
      if (typeof block === "string") return `<p>${escapeHtml(block)}</p>`;
      const url = escapeHtml(block.url);
      return `<p>${escapeHtml(block.lead)}<br><a href="${url}">${url}</a></p>`;
    })
    .join("\n");
  return { to: input.to, subject: input.subject, text, html, kind: input.kind };
}

/** A name on one line, or null when nothing is left of it. */
function nameOrNull(name: string | null): string | null {
  const clean = name === null ? "" : singleLine(name);
  return clean === "" ? null : clean;
}

/** "Klopt dit niet? ..." with the organization's contact address; left out without one. */
function contactBlocks(contactEmail: string | null): Block[] {
  const contact = contactEmail === null ? "" : singleLine(contactEmail);
  return contact === "" ? [] : [`Klopt dit niet? Neem contact op met ${contact}.`];
}

/** To someone who was added to a working group by address. */
export function buildAddedMail(input: {
  to: string;
  recipientName: string;
  byName: string | null;
  workingGroupName: string;
  contactEmail: string | null;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  const by = nameOrNull(input.byName);
  return compose({
    kind: "added-to-working-group",
    to: input.to,
    recipientName: input.recipientName,
    subject: `Je bent toegevoegd aan werkgroep ${group}`,
    blocks: [
      by === null
        ? `Je bent toegevoegd aan werkgroep ${group} in PadVinder.`
        : `${by} heeft je toegevoegd aan werkgroep ${group} in PadVinder.`,
      { lead: "Open PadVinder en log in met dit e-mailadres:", url: input.appUrl },
      ...contactBlocks(input.contactEmail),
    ],
  });
}

/** To the first coordinator of a new working group, when that is not the one who made it. */
export function buildFirstCoordinatorMail(input: {
  to: string;
  recipientName: string;
  byName: string | null;
  workingGroupName: string;
  contactEmail: string | null;
  portalUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  const by = nameOrNull(input.byName);
  return compose({
    kind: "first-coordinator",
    to: input.to,
    recipientName: input.recipientName,
    subject: `Je bent toegevoegd aan werkgroep ${group}`,
    blocks: [
      by === null
        ? `Je bent coördinator van werkgroep ${group} in PadVinder.`
        : `${by} heeft je coördinator gemaakt van werkgroep ${group} in PadVinder.`,
      { lead: "Open het portaal en log in met dit e-mailadres:", url: input.portalUrl },
      ...contactBlocks(input.contactEmail),
    ],
  });
}

/**
 * To someone with a profile already, whom someone tried to add: they are not added, but asked
 * to ask for the working group themselves.
 */
export function buildInvitedMail(input: {
  to: string;
  recipientName: string;
  byName: string | null;
  workingGroupName: string;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  const by = nameOrNull(input.byName) ?? "Iemand";
  return compose({
    kind: "invited-to-working-group",
    to: input.to,
    recipientName: input.recipientName,
    subject: `${by} wil je toevoegen aan werkgroep ${group}`,
    blocks: [
      `${by} wil je toevoegen aan werkgroep ${group} in PadVinder.`,
      {
        lead: 'Wil je dat? Open PadVinder, ga naar Meer > Profiel en kies "Meld je aan bij nog een werkgroep".',
        url: input.appUrl,
      },
      "Wil je dat niet? Dan hoef je niets te doen.",
    ],
  });
}

/** To someone who was made admin of an organization. */
export function buildOrganizationAdminMail(input: {
  to: string;
  recipientName: string;
  organizationName: string;
  portalUrl: string;
}): Mail {
  const organization = singleLine(input.organizationName);
  return compose({
    kind: "organization-admin",
    to: input.to,
    recipientName: input.recipientName,
    subject: `Je bent beheerder van ${organization}`,
    blocks: [
      `Je bent beheerder van ${organization} in PadVinder.`,
      { lead: "Open het portaal en log in met dit e-mailadres:", url: input.portalUrl },
    ],
  });
}
