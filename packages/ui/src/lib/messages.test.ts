import { loginErrors } from "@padvinder/contracts";
import { expect, test } from "vitest";
import type { AccountDeletionBlocker } from "@padvinder/contracts";
import {
  accountDeletionBlockedMessage,
  addMemberOutcomeMessage,
  apiErrorMessage,
  connectionMessage,
  loginErrorMessage,
  organizationNameTakenMessage,
  personOutsideOrganizationMessage,
  speciesNameTakenMessage,
  workingGroupNameTakenMessage,
} from "./messages";

test("every login error has its own Dutch text", () => {
  const texts = loginErrors.map(loginErrorMessage);
  for (const text of texts) expect(text).toMatch(/^[A-Z].{10,}\.$/);
  expect(new Set(texts).size).toBe(loginErrors.length);
  expect(loginErrorMessage("wrong_code")).toBe("Deze code klopt niet. Kijk nog eens in je mail.");
  expect(loginErrorMessage("failed")).toBe(connectionMessage);
});

test("the daily limit does not promise a quarter of an hour", () => {
  expect(loginErrorMessage("too_many_codes_today")).not.toMatch(/kwartier/);
  expect(loginErrorMessage("too_busy")).not.toMatch(/nieuwe code/);
});

test.each([
  [
    "too_many_requests",
    "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw.",
  ],
  ["already_decided", "Deze aanmelding is al behandeld."],
  [
    "last_platform_admin",
    "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder.",
  ],
  ["not_allowed", "Dit mag je niet doen."],
  ["not_found", "Dit bestaat niet meer."],
  ["membership_changed", "Deze persoon heeft intussen een andere rol. Kijk opnieuw."],
  [
    "last_organization_admin",
    "Een organisatie heeft altijd een beheerder. Maak eerst iemand anders beheerder.",
  ],
  [
    "last_coordinator",
    "Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator.",
  ],
  ["no_coordinator", "Deze werkgroep heeft geen coördinator. Maak eerst iemand coördinator."],
  ["too_many_addresses", "Voeg hoogstens tweehonderd adressen per keer toe."],
  ["too_many_additions", "Je hebt vandaag te veel mensen toegevoegd. Probeer het morgen opnieuw."],
  ["internal_error", connectionMessage],
  ["something_new", connectionMessage],
  ["toString", connectionMessage],
  [null, connectionMessage],
])("apiErrorMessage(%s)", (code, text) => {
  expect(apiErrorMessage(code)).toBe(text);
});

test("name_taken has a general text, and each species field its own", () => {
  expect(apiErrorMessage("name_taken")).toBe("Deze naam bestaat al.");
  expect(speciesNameTakenMessage("dutchName")).toBe(
    "Er is al een soort met deze Nederlandse naam.",
  );
  expect(speciesNameTakenMessage("scientificName")).toBe(
    "Er is al een soort met deze wetenschappelijke naam.",
  );
  expect(speciesNameTakenMessage("somethingElse")).toBe("Deze naam bestaat al.");
  expect(speciesNameTakenMessage("toString")).toBe("Deze naam bestaat al.");
});

test.each<[AccountDeletionBlocker, string]>([
  [
    {
      role: "coordinator",
      workingGroupName: "Noord",
      organizationName: "Paddentrek Voorbeeldstad",
      contactEmail: "contact-voorbeeldstad@example.test",
    },
    "Je bent de enige coördinator van Noord. Vraag contact-voorbeeldstad@example.test om eerst iemand anders coördinator te maken.",
  ],
  [
    {
      role: "coordinator",
      workingGroupName: "Dorp",
      organizationName: "Paddenwerkgroep Fictiefdorp",
      contactEmail: null,
    },
    "Je bent de enige coördinator van Dorp. Vraag de beheerder van Paddenwerkgroep Fictiefdorp om eerst iemand anders coördinator te maken.",
  ],
  [
    {
      role: "organizationAdmin",
      workingGroupName: null,
      organizationName: "Paddentrek Voorbeeldstad",
      contactEmail: "contact-voorbeeldstad@example.test",
    },
    "Je bent de enige beheerder van Paddentrek Voorbeeldstad. Vraag contact-voorbeeldstad@example.test om eerst iemand anders beheerder te maken.",
  ],
  [
    {
      role: "organizationAdmin",
      workingGroupName: null,
      organizationName: "Paddenwerkgroep Fictiefdorp",
      contactEmail: null,
    },
    "Je bent de enige beheerder van Paddenwerkgroep Fictiefdorp. Vraag een hoofdbeheerder om eerst iemand anders beheerder te maken.",
  ],
])("accountDeletionBlockedMessage(%j) gives %j", (blocker, text) => {
  expect(accountDeletionBlockedMessage(blocker)).toBe(text);
});

test("the administration texts", () => {
  expect(personOutsideOrganizationMessage("Paddentrek Voorbeeldstad")).toBe(
    "Deze persoon heeft al een account buiten Paddentrek Voorbeeldstad. Kies iemand anders of word eerst zelf coördinator.",
  );
  expect(organizationNameTakenMessage).toBe("Er is al een organisatie met deze naam.");
  expect(workingGroupNameTakenMessage).toBe("Er is al een werkgroep met deze naam.");
});

test.each([
  [{ email: "a@example.test", outcome: "added" }, "a@example.test is toegevoegd."],
  [{ email: "a@example.test", outcome: "approved" }, "a@example.test is toegelaten."],
  [
    { email: "a@example.test", outcome: "invited" },
    "a@example.test heeft al een account en krijgt een mail.",
  ],
  [{ email: "a@example.test", outcome: "already_member" }, "a@example.test is al lid."],
  [{ email: "jan@", outcome: "invalid" }, "'jan@' is geen geldig e-mailadres."],
] as const)("%j gives %j", (result, text) => {
  expect(addMemberOutcomeMessage(result)).toBe(text);
});
