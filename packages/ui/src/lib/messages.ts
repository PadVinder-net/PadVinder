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

const apiErrorMessages: Record<string, string> = {
  too_many_requests: "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw.",
  already_decided: "Deze aanmelding is al behandeld.",
  last_platform_admin: "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder.",
  not_allowed: "Dit mag je niet doen.",
  not_found: "Dit bestaat niet meer.",
  membership_changed: "Deze persoon heeft intussen een andere rol. Kijk opnieuw.",
  name_taken: "Deze naam bestaat al.",
};

/**
 * The Dutch text for an error `code` of our API (`apiErrorCode` in `@padvinder/api-client`), or
 * the connection message for `null` and any code without its own text. Never shows the English
 * `message`.
 */
export function apiErrorMessage(code: string | null): string {
  return (
    (code !== null && Object.hasOwn(apiErrorMessages, code) && apiErrorMessages[code]) ||
    connectionMessage
  );
}

const speciesNameTakenMessages: Record<string, string> = {
  dutchName: "Er is al een soort met deze Nederlandse naam.",
  scientificName: "Er is al een soort met deze wetenschappelijke naam.",
};

/** The text for a `name_taken` error about one species field (`issues[0].path`); the general text for any other field. */
export function speciesNameTakenMessage(field: string): string {
  return Object.hasOwn(speciesNameTakenMessages, field)
    ? speciesNameTakenMessages[field]!
    : apiErrorMessage("name_taken");
}
