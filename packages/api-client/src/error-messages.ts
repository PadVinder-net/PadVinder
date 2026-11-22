import { apiErrorSchema } from "@padvinder/contracts";

/**
 * The stable `code` of an error the generated client threw, when it is our API's error body.
 * `null` for a network failure (the request never got an answer), a proxy's page during a deploy,
 * or anything else.
 */
export function apiErrorCode(error: unknown): string | null {
  const parsed = apiErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : null;
}

const fallbackMessage = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

const messages: Record<string, string> = {
  too_many_requests: "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw.",
  already_decided: "Deze aanmelding is al behandeld.",
  last_platform_admin: "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder.",
  not_allowed: "Dit mag je niet doen.",
  not_found: "Dit bestaat niet meer.",
  membership_changed: "Deze persoon heeft intussen een andere rol. Kijk opnieuw.",
};

/** The Dutch text for an error `code` from `apiErrorCode`. Never shows the English `message`. */
export function apiErrorMessage(code: string | null): string {
  return (code !== null && Object.hasOwn(messages, code) && messages[code]) || fallbackMessage;
}
