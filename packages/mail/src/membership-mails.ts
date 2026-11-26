import { greeting, singleLine } from "./greeting";
import { escapeHtml } from "./html";
import type { Mail } from "./mailer";

/** Paragraphs separated by a blank line; a paragraph that is only the url becomes a link. */
function build(
  kind: string,
  to: string,
  recipientName: string,
  subject: string,
  paragraphs: string[],
  url: string,
): Mail {
  const hello = greeting(recipientName);
  const text = [hello, ...paragraphs, url].join("\n\n");
  const html = [
    ...[hello, ...paragraphs].map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  ].join("\n");
  return { to, subject, text, html, kind };
}

/**
 * To a coordinator (or admin): the applicant's name is the only other personal data in it. A
 * request sent straight to the API can come before the person gave a name: then the mail says
 * "Iemand". The link is the app's address for the request, which sends a laptop on to the portal.
 */
export function buildNewRequestMail(input: {
  to: string;
  recipientName: string;
  applicantName: string;
  workingGroupName: string;
  requestUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  const applicant = singleLine(input.applicantName) || "Iemand";
  const hello = greeting(input.recipientName);
  const line = `${applicant} wil meedoen met werkgroep ${group}.`;
  const lookup = "Bekijk de aanmelding:";
  const where = "Je vindt de aanmelding ook in de app, onder Meer > Aanmeldingen.";
  return {
    to: input.to,
    subject: `Nieuwe aanmelding bij ${group}`,
    text: [hello, line, `${lookup}\n${input.requestUrl}`, where].join("\n\n"),
    html: [
      `<p>${escapeHtml(hello)}</p>`,
      `<p>${escapeHtml(line)}</p>`,
      `<p><a href="${escapeHtml(input.requestUrl)}">Bekijk aanmelding</a></p>`,
      `<p>${escapeHtml(where)}</p>`,
    ].join("\n"),
    kind: "new-request",
  };
}

/** To the applicant after an approval. */
export function buildApprovedMail(input: {
  to: string;
  recipientName: string;
  workingGroupName: string;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  return build(
    "approved",
    input.to,
    input.recipientName,
    `Je bent toegelaten tot werkgroep ${group}`,
    [`Welkom bij werkgroep ${group}! Open PadVinder om te beginnen.`],
    input.appUrl,
  );
}

/** To the applicant after a rejection. */
export function buildRejectedMail(input: {
  to: string;
  recipientName: string;
  workingGroupName: string;
  appUrl: string;
}): Mail {
  const group = singleLine(input.workingGroupName);
  return build(
    "rejected",
    input.to,
    input.recipientName,
    `Je aanmelding bij werkgroep ${group}`,
    [
      `Je aanmelding bij werkgroep ${group} is niet goedgekeurd. In PadVinder kun je een andere werkgroep kiezen.`,
    ],
    input.appUrl,
  );
}
