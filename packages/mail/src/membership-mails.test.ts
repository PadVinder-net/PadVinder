import { expect, test } from "vitest";
import { buildApprovedMail, buildNewRequestMail, buildRejectedMail } from "./membership-mails";

const requestUrl = "https://padvinder.test/app/more/membership-requests/x";
const appUrl = "https://padvinder.test/app/";

function newRequest(overrides: Partial<Parameters<typeof buildNewRequestMail>[0]> = {}) {
  return buildNewRequestMail({
    to: "c@example.test",
    recipientName: "Kees",
    applicantName: "Noor de Vries",
    workingGroupName: "Boekelo",
    requestUrl,
    ...overrides,
  });
}

test("the new-request mail names the applicant and the group and links to the request", () => {
  const mail = newRequest();
  expect(mail.to).toBe("c@example.test");
  expect(mail.subject).toBe("Nieuwe aanmelding bij Boekelo");
  expect(mail.text).toBe(
    [
      "Hallo Kees,",
      "Noor de Vries wil meedoen met werkgroep Boekelo.",
      `Bekijk de aanmelding:\n${requestUrl}`,
      "Je vindt de aanmelding ook in de app, onder Meer > Aanmeldingen.",
    ].join("\n\n"),
  );
});

test("the request mail has one button, Bekijk aanmelding, to the app's address for the request", () => {
  const mail = newRequest();
  expect(mail.html.match(/<a /g)).toHaveLength(1);
  expect(mail.html).toContain(`href="${requestUrl}"`);
  expect(mail.html).toMatch(/<a [^>]*>Bekijk aanmelding<\/a>/);
});

test("the request mail says where to find the request in the app", () => {
  expect(newRequest().text).toContain("onder Meer > Aanmeldingen.");
  expect(newRequest().html).toContain("onder Meer &gt; Aanmeldingen.");
});

test("an applicant without a name is called Iemand", () => {
  for (const applicantName of ["", "  ", "\n"]) {
    const mail = newRequest({ applicantName });
    expect(mail.text.split("\n\n")[1]).toBe("Iemand wil meedoen met werkgroep Boekelo.");
    expect(mail.html).toContain("<p>Iemand wil meedoen met werkgroep Boekelo.</p>");
  }
});

test("markup in a name is escaped in the html part and left as text in the text part", () => {
  const mail = newRequest({ applicantName: "<b>Noor</b>", workingGroupName: "Noord" });
  expect(mail.html).toContain("&lt;b&gt;Noor&lt;/b&gt;");
  expect(mail.html).not.toContain("<b>Noor</b>");
  expect(mail.text).toContain("<b>Noor</b> wil meedoen");
});

test("markup in a name is escaped in the greeting", () => {
  const mail = newRequest({ recipientName: "<b>Noor</b>" });
  expect(mail.html).toContain("<p>Hallo &lt;b&gt;Noor&lt;/b&gt;,</p>");
  expect(mail.html).not.toContain("<b>Noor</b>");
});

test("a line break in a name cannot start a new line in the mail", () => {
  for (const separator of ["\n", "\r\n", "\r", "\u2028", "\u2029", "\u0085", "\v", "\f"]) {
    const mail = newRequest({
      applicantName: `Noor${separator}Bcc: x@example.test`,
      workingGroupName: `Noord${separator}Subject: y`,
    });
    expect(mail.subject).toBe("Nieuwe aanmelding bij Noord Subject: y");
    expect(mail.text.split("\n\n")[1]).toBe(
      "Noor Bcc: x@example.test wil meedoen met werkgroep Noord Subject: y.",
    );
    expect(mail.text.split("\n\n")[1]).not.toMatch(/[\r\n\u2028\u2029\u0085\v\f]/);
    expect(mail.html).not.toContain("<br>");
  }
});

test("the approved and rejected mails have the exact subjects and texts", () => {
  const input = {
    to: "a@example.test",
    recipientName: "Noor",
    workingGroupName: "Boekelo",
    appUrl,
  };
  const approved = buildApprovedMail(input);
  expect(approved.subject).toBe("Je bent toegelaten tot werkgroep Boekelo");
  expect(approved.text).toBe(
    `Hallo Noor,\n\nWelkom bij werkgroep Boekelo! Open PadVinder om te beginnen.\n\n${appUrl}`,
  );
  expect(approved.html).toContain(`<a href="${appUrl}">${appUrl}</a>`);
  const rejected = buildRejectedMail(input);
  expect(rejected.subject).toBe("Je aanmelding bij werkgroep Boekelo");
  expect(rejected.text).toBe(
    `Hallo Noor,\n\nJe aanmelding bij werkgroep Boekelo is niet goedgekeurd. In PadVinder kun je een andere werkgroep kiezen.\n\n${appUrl}`,
  );
});

test("every mail starts with Hallo {naam}, or Hallo, and an empty line, in text and HTML", () => {
  const base = { to: "a@example.test", workingGroupName: "Boekelo", appUrl };
  for (const [name, expected] of [
    ["Noor", "Hallo Noor,"],
    ["", "Hallo,"],
  ] as const) {
    const mails = [
      buildApprovedMail({ ...base, recipientName: name }),
      buildRejectedMail({ ...base, recipientName: name }),
      newRequest({ recipientName: name }),
    ];
    for (const mail of mails) {
      expect(mail.text.startsWith(`${expected}\n\n`)).toBe(true);
      expect(mail.html.startsWith(`<p>${expected}</p>\n<p>`)).toBe(true);
    }
  }
});
