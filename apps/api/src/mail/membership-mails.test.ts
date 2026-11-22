import { expect, test } from "vitest";
import { buildApprovedMail, buildNewRequestMail, buildRejectedMail } from "./membership-mails";

const requestUrl = "https://padvinder.test/app/more/membership-requests/x";

test("the new-request mail names the applicant and the group and links to the request", () => {
  const mail = buildNewRequestMail({
    to: "c@example.test",
    applicantName: "Noor de Vries",
    workingGroupName: "Boekelo",
    requestUrl,
  });
  expect(mail.to).toBe("c@example.test");
  expect(mail.subject).toBe("Nieuwe aanmelding bij Boekelo");
  expect(mail.text).toBe(
    [
      "Noor de Vries wil meedoen met werkgroep Boekelo.",
      "Open PadVinder en ga naar Meer > Aanmeldingen om de aanmelding te bekijken.",
      requestUrl,
    ].join("\n\n"),
  );
  expect(mail.html).toContain(`<a href="${requestUrl}">${requestUrl}</a>`);
  expect(mail.html).toContain("Meer &gt; Aanmeldingen");
});

test("an applicant without a name is called Iemand", () => {
  for (const applicantName of ["", "  ", "\n"]) {
    const mail = buildNewRequestMail({
      to: "c@example.test",
      applicantName,
      workingGroupName: "Boekelo",
      requestUrl,
    });
    expect(mail.text.split("\n\n")[0]).toBe("Iemand wil meedoen met werkgroep Boekelo.");
    expect(mail.html).toContain("<p>Iemand wil meedoen met werkgroep Boekelo.</p>");
  }
});

test("markup in a name is escaped in the html part and left as text in the text part", () => {
  const mail = buildNewRequestMail({
    to: "c@example.test",
    applicantName: "<b>Noor</b>",
    workingGroupName: "Noord",
    requestUrl,
  });
  expect(mail.html).toContain("&lt;b&gt;Noor&lt;/b&gt;");
  expect(mail.html).not.toContain("<b>Noor</b>");
  expect(mail.text).toContain("<b>Noor</b> wil meedoen");
});

test("a line break in a name cannot start a new line in the mail", () => {
  for (const separator of ["\n", "\r\n", "\r", "\u2028", "\u2029", "\u0085", "\v", "\f"]) {
    const mail = buildNewRequestMail({
      to: "c@example.test",
      applicantName: `Noor${separator}Bcc: x@example.test`,
      workingGroupName: `Noord${separator}Subject: y`,
      requestUrl,
    });
    expect(mail.subject).toBe("Nieuwe aanmelding bij Noord Subject: y");
    expect(mail.text.split("\n\n")[0]).toBe(
      "Noor Bcc: x@example.test wil meedoen met werkgroep Noord Subject: y.",
    );
    expect(mail.text.split("\n\n")[0]).not.toMatch(/[\r\n\u2028\u2029\u0085\v\f]/);
    expect(mail.html).not.toContain("<br>");
  }
});

test("the approved and rejected mails have the exact subjects and texts", () => {
  const appUrl = "https://padvinder.test/app/";
  const approved = buildApprovedMail({ to: "a@example.test", workingGroupName: "Boekelo", appUrl });
  expect(approved.subject).toBe("Je bent toegelaten tot werkgroep Boekelo");
  expect(approved.text).toBe(
    `Welkom bij werkgroep Boekelo! Open PadVinder om te beginnen.\n\n${appUrl}`,
  );
  expect(approved.html).toContain(`<a href="${appUrl}">${appUrl}</a>`);
  const rejected = buildRejectedMail({ to: "a@example.test", workingGroupName: "Boekelo", appUrl });
  expect(rejected.subject).toBe("Je aanmelding bij werkgroep Boekelo");
  expect(rejected.text).toBe(
    `Je aanmelding bij werkgroep Boekelo is niet goedgekeurd. In PadVinder kun je een andere werkgroep kiezen.\n\n${appUrl}`,
  );
});
