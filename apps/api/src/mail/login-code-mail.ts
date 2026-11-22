import { paragraphsToHtml } from "./html";
import type { Mail } from "./mailer";

// The mail holds no digit besides the code, in text or HTML, so that phones find the code.
export function buildLoginCodeMail({ to, code }: { to: string; code: string }): Mail {
  const text = [
    `Je code: ${code}`,
    "Vul deze code in bij PadVinder om in te loggen. De code is een half uur geldig.",
    "Heb je geen code aangevraagd? Dan hoef je niets te doen.",
  ].join("\n\n");
  return {
    to,
    subject: `${code} is je inlogcode voor PadVinder`,
    text,
    html: paragraphsToHtml(text),
  };
}
