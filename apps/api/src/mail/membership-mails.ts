import { escapeHtml } from "./html";
import type { Mail } from "./mailer";

// A line break in a name would start a new line in the text part and a new header line in the
// subject. Besides \r and \n: vertical tab, form feed, NEL and the Unicode line and paragraph
// separators.
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]+/g;
const singleLine = (name: string) => name.replace(LINE_BREAKS, " ").trim();

/** Paragraphs separated by a blank line; a paragraph that is only the url becomes a link. */
function build(kind: string, to: string, subject: string, paragraphs: string[], url: string): Mail {
  const text = [...paragraphs, url].join("\n\n");
  const html = [
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  ].join("\n");
  return { to, subject, text, html, kind };
}

/**
 * To a coordinator (or admin): the applicant's name is the only personal data in it. A request
 * sent straight to the API can come before the person gave a name: then the mail says "Iemand".
 */
export function buildNewRequestMail(input: {
  to: string;
  applicantName: string;
  workingGroupName: string;
  /** Part 2 (the portal) changes this to the portal's page for the request. */
  requestUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  const applicant = singleLine(input.applicantName) || "Iemand";
  return build(
    "new-request",
    input.to,
    `Nieuwe aanmelding bij ${group}`,
    [
      `${applicant} wil meedoen met werkgroep ${group}.`,
      "Open PadVinder en ga naar Meer > Aanmeldingen om de aanmelding te bekijken.",
    ],
    input.requestUrl,
  );
}

/** To the applicant after an approval. */
export function buildApprovedMail(input: {
  to: string;
  workingGroupName: string;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  return build(
    "approved",
    input.to,
    `Je bent toegelaten tot werkgroep ${group}`,
    [`Welkom bij werkgroep ${group}! Open PadVinder om te beginnen.`],
    input.appUrl,
  );
}

/** To the applicant after a rejection. */
export function buildRejectedMail(input: {
  to: string;
  workingGroupName: string;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  return build(
    "rejected",
    input.to,
    `Je aanmelding bij werkgroep ${group}`,
    [
      `Je aanmelding bij werkgroep ${group} is niet goedgekeurd. In PadVinder kun je een andere werkgroep kiezen.`,
    ],
    input.appUrl,
  );
}
