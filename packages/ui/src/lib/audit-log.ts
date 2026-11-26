import type {
  AuditAction,
  AuditActionGroup,
  AuditLogEntry,
  AuditLogPerson,
} from "@padvinder/contracts";
import { displayName } from "./display-name";

/** The fixed text for each kind of person the reader may not see by name. */
const personTexts: Record<Exclude<AuditLogPerson["kind"], "named">, string> = {
  former_member: "Voormalig lid",
  deleted_account: "Verwijderd account",
  platform_admin: "Hoofdbeheerder",
  system: "Systeem",
};

/** Who acted, or whom an entry is about, as the reader may see them. */
export function auditLogPersonName(person: AuditLogPerson): string {
  if (person.kind === "named") return displayName(person.name ?? "", person.hasLoggedIn);
  return personTexts[person.kind];
}

export const auditActionGroupLabels: Record<AuditActionGroup, string> = {
  organization: "Organisaties",
  workingGroup: "Werkgroepen",
  role: "Rollen",
  membership: "Leden en aanmeldingen",
  account: "Accounts",
  species: "Soorten",
};

const person = (entry: AuditLogEntry) =>
  entry.person ? auditLogPersonName(entry.person) : "iemand";
const workingGroup = (entry: AuditLogEntry) => entry.workingGroup?.name ?? "een werkgroep";
const organization = (entry: AuditLogEntry) => entry.organization?.name ?? "een organisatie";
const species = (entry: AuditLogEntry) => entry.species?.dutchName ?? "een soort";

/** A text value of `details`; anything else (absent, empty, another type) is no value. */
function detailText(entry: AuditLogEntry, key: string): string | undefined {
  const value = entry.details[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** `{from} wordt {to}` when the entry holds both, prefixed with `label` when given. */
function change(entry: AuditLogEntry, field: string, label?: string): string | undefined {
  const from = detailText(entry, `${field}From`);
  const to = detailText(entry, `${field}To`);
  if (from === undefined || to === undefined) return undefined;
  return `${label ? `${label} ` : ""}${from} wordt ${to}`;
}

/** The parts that apply, joined with `, `. */
function parts(...items: (string | undefined | false)[]): string {
  return items.filter((item): item is string => typeof item === "string").join(", ");
}

function verificationPart(entry: AuditLogEntry): string | undefined {
  const to = entry.details.needsVerificationTo;
  if (to === true) return "betrouwbaarheidscheck aan";
  if (to === false) return "betrouwbaarheidscheck uit";
  return undefined;
}

/**
 * One sentence per action. Typed by `AuditAction`, so a new action in `auditActions` does not
 * compile until it has its sentence here.
 */
const sentences: Record<AuditAction, (entry: AuditLogEntry) => string> = {
  "organization.created": (entry) => `Organisatie toegevoegd: ${organization(entry)}`,
  "organization.updated": (entry) =>
    `Organisatie gewijzigd: ${parts(
      change(entry, "organizationName") ?? organization(entry),
      entry.details.contactChanged === true && "contactadres gewijzigd",
    )}`,
  "working_group.created": (entry) => `Werkgroep toegevoegd: ${workingGroup(entry)}`,
  "working_group.updated": (entry) =>
    `Werkgroep gewijzigd: ${parts(
      change(entry, "workingGroupName") ?? workingGroup(entry),
      change(entry, "city", "plaats"),
    )}`,
  "working_group.deactivated": (entry) => `Werkgroep uitgezet: ${workingGroup(entry)}`,
  "working_group.activated": (entry) => `Werkgroep aangezet: ${workingGroup(entry)}`,
  "role.platform_admin_granted": (entry) => `Hoofdbeheerder gemaakt: ${person(entry)}`,
  "role.platform_admin_revoked": (entry) => `Niet langer hoofdbeheerder: ${person(entry)}`,
  "role.organization_admin_granted": (entry) =>
    `Beheerder gemaakt: ${person(entry)} bij ${organization(entry)}`,
  "role.organization_admin_revoked": (entry) =>
    `Niet langer beheerder: ${person(entry)} bij ${organization(entry)}`,
  "role.coordinator_granted": (entry) =>
    `Coördinator gemaakt: ${person(entry)} bij ${workingGroup(entry)}`,
  "role.coordinator_revoked": (entry) =>
    `Niet langer coördinator: ${person(entry)} bij ${workingGroup(entry)}`,
  "membership_request.approved": (entry) =>
    `Aanmelding goedgekeurd: ${person(entry)} bij ${workingGroup(entry)}`,
  "membership_request.rejected": (entry) =>
    `Aanmelding afgewezen: ${person(entry)} bij ${workingGroup(entry)}`,
  "membership.added": (entry) => `Lid toegevoegd: ${person(entry)} bij ${workingGroup(entry)}`,
  "membership.invited": (entry) =>
    `Uitgenodigd om zich aan te melden: ${person(entry)} bij ${workingGroup(entry)}`,
  "membership.removed": (entry) => `Lid verwijderd: ${person(entry)} uit ${workingGroup(entry)}`,
  "account.deleted": () => "Account verwijderd",
  "passkey.added": (entry) => `Toegangssleutel toegevoegd: ${person(entry)}`,
  "passkey.removed": (entry) => `Toegangssleutel verwijderd: ${person(entry)}`,
  "passkey.reset": (entry) => `Alle toegangssleutels verwijderd: ${person(entry)}`,
  "species.created": (entry) => `Soort toegevoegd: ${species(entry)}`,
  "species.updated": (entry) =>
    `Soort gewijzigd: ${parts(
      change(entry, "dutchName") ?? species(entry),
      change(entry, "scientificName", "wetenschappelijke naam"),
      verificationPart(entry),
    )}`,
  "species.deactivated": (entry) => `Soort uitgezet: ${species(entry)}`,
  "species.activated": (entry) => `Soort aangezet: ${species(entry)}`,
};

function isKnownAction(action: string): action is AuditAction {
  return Object.hasOwn(sentences, action);
}

/**
 * What an entry says, in one Dutch sentence. An action this portal does not know (a newer API
 * may write one) reads as its own text.
 */
export function auditLogSentence(entry: AuditLogEntry): string {
  return isKnownAction(entry.action) ? sentences[entry.action](entry) : entry.action;
}
