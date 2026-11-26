import {
  auditActionGroups,
  auditActions,
  type AuditLogEntry,
  type AuditLogPerson,
} from "@padvinder/contracts";
import { auditLogFixture } from "@padvinder/contracts/fixtures";
import { describe, expect, test } from "vitest";
import { auditActionGroupLabels, auditLogPersonName, auditLogSentence } from "./audit-log";

const noord = { id: "0192f3c0-0000-7000-8000-0000000000b1", name: "Noord" };
const voorbeeldstad = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};

const entry: AuditLogEntry = {
  id: "0192f3c0-0000-7000-8000-000000000f01",
  occurredAt: "2026-11-25T08:00:05.123Z",
  action: "membership_request.approved",
  actor: { kind: "named", name: "Coördinator Noord", hasLoggedIn: true },
  person: { kind: "named", name: "Noor de Vries", hasLoggedIn: true },
  organization: voorbeeldstad,
  workingGroup: noord,
  species: null,
  details: { workingGroupId: noord.id },
};

describe("auditLogSentence", () => {
  test("every action of auditActions has a sentence that is not its own action text", () => {
    for (const action of auditActions) {
      const found = auditLogFixture.filter((item) => item.action === action);
      expect(found, action).not.toHaveLength(0);
      for (const item of found) expect(auditLogSentence(item), action).not.toBe(action);
    }
  });

  test.each([
    ["membership_request.approved", "Aanmelding goedgekeurd: Noor de Vries bij Noord"],
    ["species.updated", "Soort gewijzigd: gewone pat wordt gewone pad"],
    ["membership.removed", "Lid verwijderd: Voormalig lid uit Noord"],
    ["role.platform_admin_granted", "Hoofdbeheerder gemaakt: (nog niet ingelogd)"],
    ["account.deleted", "Account verwijderd"],
  ])("%s reads %j", (action, sentence) => {
    const cases: Record<string, AuditLogEntry> = {
      "membership_request.approved": entry,
      "species.updated": {
        ...entry,
        action: "species.updated",
        person: null,
        organization: null,
        workingGroup: null,
        species: { id: "01a204b4-08c6-7dc0-ae95-8072a93f1667", dutchName: "gewone pad" },
        details: { dutchNameFrom: "gewone pat", dutchNameTo: "gewone pad" },
      },
      "membership.removed": {
        ...entry,
        action: "membership.removed",
        person: { kind: "former_member" },
        details: { workingGroupId: noord.id, role: "volunteer" },
      },
      "role.platform_admin_granted": {
        ...entry,
        action: "role.platform_admin_granted",
        actor: { kind: "system" },
        person: { kind: "named", name: "", hasLoggedIn: false },
        organization: null,
        workingGroup: null,
        details: {},
      },
      "account.deleted": {
        ...entry,
        action: "account.deleted",
        actor: { kind: "deleted_account" },
        person: { kind: "deleted_account" },
        organization: null,
        workingGroup: null,
        details: {},
      },
    };
    expect(auditLogSentence(cases[action]!)).toBe(sentence);
  });

  test("an action the page does not know shows its own text", () => {
    expect(auditLogSentence({ ...entry, action: "safety_test.published" })).toBe(
      "safety_test.published",
    );
    // Not a key of the sentences, even though every object has it.
    expect(auditLogSentence({ ...entry, action: "constructor" })).toBe("constructor");
    expect(auditLogSentence({ ...entry, action: "__proto__" })).toBe("__proto__");
  });

  test("working_group.updated with only a city reads 'Werkgroep gewijzigd: Noord, plaats Voorbeeldstad wordt Fictiefdorp'", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "working_group.updated",
        person: null,
        details: { cityFrom: "Voorbeeldstad", cityTo: "Fictiefdorp" },
      }),
    ).toBe("Werkgroep gewijzigd: Noord, plaats Voorbeeldstad wordt Fictiefdorp");
  });

  test("working_group.updated with a new name and a new city joins both parts", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "working_group.updated",
        person: null,
        details: {
          workingGroupNameFrom: "Noordoost",
          workingGroupNameTo: "Noord",
          cityFrom: "Voorbeeldstad",
          cityTo: "Fictiefdorp",
        },
      }),
    ).toBe("Werkgroep gewijzigd: Noordoost wordt Noord, plaats Voorbeeldstad wordt Fictiefdorp");
  });

  test("organization.updated with a new name and contactChanged joins both parts", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "organization.updated",
        person: null,
        workingGroup: null,
        details: {
          organizationNameFrom: "Paddentrek Voorbeeld",
          organizationNameTo: "Paddentrek Voorbeeldstad",
          contactChanged: true,
        },
      }),
    ).toBe(
      "Organisatie gewijzigd: Paddentrek Voorbeeld wordt Paddentrek Voorbeeldstad, contactadres gewijzigd",
    );
  });

  test("organization.updated with only contactChanged names the organization", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "organization.updated",
        person: null,
        workingGroup: null,
        details: { contactChanged: true },
      }),
    ).toBe("Organisatie gewijzigd: Paddentrek Voorbeeldstad, contactadres gewijzigd");
  });

  test("species.updated with only the check reads 'Soort gewijzigd: kamsalamander, betrouwbaarheidscheck uit'", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "species.updated",
        person: null,
        organization: null,
        workingGroup: null,
        species: { id: "01a204b4-08c6-7dc0-ae95-8072a93f1668", dutchName: "kamsalamander" },
        details: { needsVerificationFrom: true, needsVerificationTo: false },
      }),
    ).toBe("Soort gewijzigd: kamsalamander, betrouwbaarheidscheck uit");
  });

  test("species.updated with every part joins them in order", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "species.updated",
        person: null,
        organization: null,
        workingGroup: null,
        species: { id: "01a204b4-08c6-7dc0-ae95-8072a93f1667", dutchName: "gewone pad" },
        details: {
          dutchNameFrom: "gewone pat",
          dutchNameTo: "gewone pad",
          scientificNameFrom: "Bufo bufoo",
          scientificNameTo: "Bufo bufo",
          needsVerificationFrom: false,
          needsVerificationTo: true,
        },
      }),
    ).toBe(
      "Soort gewijzigd: gewone pat wordt gewone pad, wetenschappelijke naam Bufo bufoo wordt Bufo bufo, betrouwbaarheidscheck aan",
    );
  });

  test("an entry without its person, working group or details never reads undefined", () => {
    for (const action of auditActions) {
      const sentence = auditLogSentence({
        ...entry,
        action,
        person: null,
        workingGroup: null,
        organization: null,
        species: null,
        details: {},
      });
      expect(sentence, action).not.toMatch(/undefined|null|\{|\}/);
      expect(sentence, action).not.toBe(action);
      expect(sentence.trim(), action).toBe(sentence);
      expect(sentence, action).not.toMatch(/: ?$|, ?$/);
    }
    expect(
      auditLogSentence({
        ...entry,
        action: "membership.added",
        person: null,
        workingGroup: null,
      }),
    ).toBe("Lid toegevoegd: iemand bij een werkgroep");
    expect(auditLogSentence({ ...entry, action: "organization.created", organization: null })).toBe(
      "Organisatie toegevoegd: een organisatie",
    );
    expect(auditLogSentence({ ...entry, action: "species.activated" })).toBe(
      "Soort aangezet: een soort",
    );
    expect(
      auditLogSentence({
        ...entry,
        action: "working_group.updated",
        workingGroup: null,
        details: {},
      }),
    ).toBe("Werkgroep gewijzigd: een werkgroep");
  });

  test("a details value of the wrong type is left out", () => {
    expect(
      auditLogSentence({
        ...entry,
        action: "working_group.updated",
        details: { cityFrom: 3, cityTo: null, workingGroupNameFrom: "Noordoost" },
      }),
    ).toBe("Werkgroep gewijzigd: Noord");
    expect(
      auditLogSentence({
        ...entry,
        action: "species.updated",
        species: { id: "01a204b4-08c6-7dc0-ae95-8072a93f1667", dutchName: "gewone pad" },
        details: { needsVerificationTo: "ja" },
      }),
    ).toBe("Soort gewijzigd: gewone pad");
  });

  test("the sentences read as the table says, for the fixture", () => {
    const sentences = auditLogFixture.map(auditLogSentence).reverse();
    expect(sentences).toEqual([
      "Organisatie toegevoegd: Paddentrek Voorbeeldstad",
      "Beheerder gemaakt: Beheerder Voorbeeld bij Paddentrek Voorbeeldstad",
      "Organisatie gewijzigd: Paddentrek Voorbeeldstad, contactadres gewijzigd",
      "Werkgroep toegevoegd: Noord",
      "Coördinator gemaakt: Coördinator Noord bij Noord",
      "Werkgroep gewijzigd: Noord, plaats Voorbeeldstad wordt Voorbeelddorp",
      "Werkgroep uitgezet: Noord",
      "Werkgroep aangezet: Noord",
      "Lid toegevoegd: (nog niet ingelogd) bij Noord",
      "Uitgenodigd om zich aan te melden: Voormalig lid bij Noord",
      "Aanmelding goedgekeurd: Vrijwilliger Noord bij Noord",
      "Aanmelding afgewezen: Voormalig lid bij Noord",
      "Lid verwijderd: Voormalig lid uit Noord",
      "Niet langer coördinator: Vrijwilliger Noord bij Noord",
      "Niet langer beheerder: Voormalig lid bij Paddentrek Voorbeeldstad",
      "Account verwijderd",
      "Hoofdbeheerder gemaakt: Beheerder Voorbeeld",
      "Niet langer hoofdbeheerder: Beheerder Voorbeeld",
      "Soort toegevoegd: gewone pad",
      "Soort gewijzigd: gewone pad, betrouwbaarheidscheck aan",
      "Soort uitgezet: gewone pad",
      "Soort aangezet: gewone pad",
      "safety_test.published",
    ]);
  });
});

describe("auditLogPersonName", () => {
  test.each<[AuditLogPerson["kind"], AuditLogPerson, string]>([
    ["named", { kind: "named", name: "Noor de Vries", hasLoggedIn: true }, "Noor de Vries"],
    ["former_member", { kind: "former_member" }, "Voormalig lid"],
    ["deleted_account", { kind: "deleted_account" }, "Verwijderd account"],
    ["platform_admin", { kind: "platform_admin" }, "Hoofdbeheerder"],
    ["system", { kind: "system" }, "Systeem"],
  ])("a %s person reads as the table says", (_kind, person, text) => {
    expect(auditLogPersonName(person)).toBe(text);
  });

  test("a named person who never logged in, or has no name, reads as displayName says", () => {
    expect(auditLogPersonName({ kind: "named", name: "", hasLoggedIn: false })).toBe(
      "(nog niet ingelogd)",
    );
    expect(auditLogPersonName({ kind: "named", name: "Noor", hasLoggedIn: false })).toBe(
      "(nog niet ingelogd)",
    );
    expect(auditLogPersonName({ kind: "named", name: " ", hasLoggedIn: true })).toBe(
      "(nog geen naam)",
    );
  });
});

test("every action group has its label", () => {
  expect(auditActionGroups.map((group) => auditActionGroupLabels[group])).toEqual([
    "Organisaties",
    "Werkgroepen",
    "Rollen",
    "Leden en aanmeldingen",
    "Accounts",
    "Soorten",
  ]);
});
