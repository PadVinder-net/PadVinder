import type { AccountDeletionBlocker, AddMemberOutcome, LoginError } from "@padvinder/contracts";

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
  own_account: "Dit is je eigen account. Dat verwijder je in de app, onder Meer > Profiel.",
  not_allowed: "Dit mag je niet doen.",
  not_found: "Dit bestaat niet meer.",
  passkey_required: "Bevestig eerst met je toegangssleutel.",
  too_many_passkeys: "Je hebt al tien toegangssleutels. Verwijder er eerst een.",
  membership_changed: "Deze persoon heeft intussen een andere rol. Kijk opnieuw.",
  name_taken: "Deze naam bestaat al.",
  last_organization_admin:
    "Een organisatie heeft altijd een beheerder. Maak eerst iemand anders beheerder.",
  last_coordinator:
    "Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator.",
  no_coordinator: "Deze werkgroep heeft geen coördinator. Maak eerst iemand coördinator.",
  too_many_addresses: "Voeg hoogstens tweehonderd adressen per keer toe.",
  too_many_additions: "Je hebt vandaag te veel mensen toegevoegd. Probeer het morgen opnieuw.",
  report_not_sent: "Je melding is niet verstuurd. Probeer het zo nog eens.",
  too_many_reports:
    "Je hebt in het afgelopen uur veel meldingen gestuurd. Probeer het later nog eens.",
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

/** The text for `person_outside_organization`: the address belongs to someone with a profile in another organization. */
export function personOutsideOrganizationMessage(organizationName: string): string {
  return `Deze persoon heeft al een account buiten ${organizationName}. Kies iemand anders of word eerst zelf coördinator.`;
}

export const organizationNameTakenMessage = "Er is al een organisatie met deze naam.";
export const workingGroupNameTakenMessage = "Er is al een werkgroep met deze naam.";

/**
 * Why the user cannot delete their account, for one blocker (`accountDeletionBlockers` in
 * `@padvinder/api-client`), and whom to ask: the organization's contact address, otherwise the
 * organization's admin (for a coordinator) or a platform admin (for the only admin).
 */
export function accountDeletionBlockedMessage(blocker: AccountDeletionBlocker): string {
  if (blocker.role === "coordinator") {
    const ask = blocker.contactEmail ?? `de beheerder van ${blocker.organizationName}`;
    return `Je bent de enige coördinator van ${blocker.workingGroupName ?? "je werkgroep"}. Vraag ${ask} om eerst iemand anders coördinator te maken.`;
  }
  const ask = blocker.contactEmail ?? "een hoofdbeheerder";
  return `Je bent de enige beheerder van ${blocker.organizationName}. Vraag ${ask} om eerst iemand anders beheerder te maken.`;
}

/** The same refusal for someone else's account, named by `name`: what to do first. */
export function accountDeletionBlockedForOtherMessage(
  name: string,
  blocker: AccountDeletionBlocker,
): string {
  if (blocker.role === "coordinator") {
    return `${name} is de enige coördinator van ${blocker.workingGroupName ?? "een werkgroep"}. Maak eerst iemand anders coördinator.`;
  }
  return `${name} is de enige beheerder van ${blocker.organizationName}. Maak eerst iemand anders beheerder.`;
}

/** `last_platform_admin` on the page "Hoofdbeheerders". */
export const lastLoggedInPlatformAdminMessage =
  "Er moet een hoofdbeheerder blijven die al eens is ingelogd.";

/** A lookup by address found no account. */
export const noAccountMessage = "Geen account met dit adres.";

/** What adding one address did, in one sentence: `result.email` is the address as the server normalized it. */
export function addMemberOutcomeMessage(result: {
  email: string;
  outcome: AddMemberOutcome;
}): string {
  switch (result.outcome) {
    case "added":
      return `${result.email} is toegevoegd.`;
    case "approved":
      return `${result.email} is toegelaten.`;
    case "invited":
      return `${result.email} heeft al een account en krijgt een mail.`;
    case "already_member":
      return `${result.email} is al lid.`;
    case "invalid":
      return `'${result.email}' is geen geldig e-mailadres.`;
  }
}
