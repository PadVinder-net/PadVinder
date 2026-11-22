import type { LoginError } from "@padvinder/contracts";

// Dutch texts that more than one screen shows. Written once, here.

export const connectionMessage =
  "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

export const logOutFailedMessage =
  "Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

const loginErrorMessages: Record<LoginError, string> = {
  invalid_email: "Vul een geldig e-mailadres in.",
  wrong_code: "Deze code klopt niet. Kijk nog eens in je mail.",
  code_expired: "Deze code is verlopen. Vraag een nieuwe code aan.",
  too_many_attempts: "Te veel pogingen. Vraag een nieuwe code aan.",
  too_many_codes: "Je hebt te vaak een code aangevraagd. Probeer het over een kwartier opnieuw.",
  too_many_codes_today: "Je hebt te vaak een code aangevraagd. Probeer het morgen opnieuw.",
  too_busy: "Het is nu erg druk. Probeer het over een paar minuten opnieuw.",
  failed: connectionMessage,
};

/** What a failed login step says to the user. */
export function loginErrorMessage(error: LoginError): string {
  return loginErrorMessages[error];
}
