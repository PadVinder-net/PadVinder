import type { AuditLogEntry, AuditLogPerson } from "../audit-log";

const organization = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};
const workingGroup = { id: "0192f3c0-0000-7000-8000-0000000000b1", name: "Noord" };
const species = { id: "01a204b4-08c6-7dc0-ae95-8072a93f1667", dutchName: "gewone pad" };

const system: AuditLogPerson = { kind: "system" };
const admin: AuditLogPerson = { kind: "named", name: "Beheerder Voorbeeld", hasLoggedIn: true };
const coordinator: AuditLogPerson = { kind: "named", name: "Coördinator Noord", hasLoggedIn: true };
const volunteer: AuditLogPerson = { kind: "named", name: "Vrijwilliger Noord", hasLoggedIn: true };
const notLoggedIn: AuditLogPerson = { kind: "named", name: "", hasLoggedIn: false };
const formerMember: AuditLogPerson = { kind: "former_member" };
const deletedAccount: AuditLogPerson = { kind: "deleted_account" };
const platformAdmin: AuditLogPerson = { kind: "platform_admin" };

type Entry = Omit<
  AuditLogEntry,
  "id" | "occurredAt" | "organization" | "workingGroup" | "species"
> &
  Partial<Pick<AuditLogEntry, "organization" | "workingGroup" | "species">>;

/** Oldest first here; the fixture below reverses it, so the newest comes first, as on a page. */
const entries: Entry[] = [
  { action: "organization.created", actor: system, person: null, organization, details: {} },
  {
    action: "role.organization_admin_granted",
    actor: platformAdmin,
    person: admin,
    organization,
    details: {},
  },
  {
    action: "organization.updated",
    actor: admin,
    person: null,
    organization,
    details: { contactChanged: true },
  },
  {
    action: "working_group.created",
    actor: admin,
    person: null,
    organization,
    workingGroup,
    details: {},
  },
  {
    action: "role.coordinator_granted",
    actor: admin,
    person: coordinator,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "working_group.updated",
    actor: admin,
    person: null,
    organization,
    workingGroup,
    details: { cityFrom: "Voorbeeldstad", cityTo: "Voorbeelddorp" },
  },
  {
    action: "working_group.deactivated",
    actor: admin,
    person: null,
    organization,
    workingGroup,
    details: {},
  },
  {
    action: "working_group.activated",
    actor: admin,
    person: null,
    organization,
    workingGroup,
    details: {},
  },
  {
    action: "membership.added",
    actor: coordinator,
    person: notLoggedIn,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "membership.invited",
    actor: coordinator,
    person: formerMember,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "membership_request.approved",
    actor: coordinator,
    person: volunteer,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "membership_request.rejected",
    actor: coordinator,
    person: formerMember,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "membership.removed",
    actor: coordinator,
    person: formerMember,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id, role: "volunteer" },
  },
  {
    action: "role.coordinator_revoked",
    actor: admin,
    person: volunteer,
    organization,
    workingGroup,
    details: { workingGroupId: workingGroup.id },
  },
  {
    action: "role.organization_admin_revoked",
    actor: platformAdmin,
    person: formerMember,
    organization,
    details: {},
  },
  { action: "account.deleted", actor: deletedAccount, person: deletedAccount, details: {} },
  { action: "role.platform_admin_granted", actor: system, person: admin, details: {} },
  { action: "role.platform_admin_revoked", actor: admin, person: admin, details: {} },
  {
    action: "species.created",
    actor: admin,
    person: null,
    species,
    details: { dutchName: "gewone pad", scientificName: "Bufo bufo", needsVerification: false },
  },
  {
    action: "species.updated",
    actor: admin,
    person: null,
    species,
    details: { needsVerificationFrom: false, needsVerificationTo: true },
  },
  { action: "species.deactivated", actor: admin, person: null, species, details: {} },
  { action: "species.activated", actor: admin, person: null, species, details: {} },
  // An action a newer API writes, which this portal does not know.
  { action: "safety_test.published", actor: admin, person: null, details: { version: 2 } },
];

/**
 * A page of the audit log, newest first: one entry for every action in `auditActions`, a person of
 * every kind, the short updates (only the contact address, only the city, only the check), and
 * one action the portal does not know.
 */
export const auditLogFixture: AuditLogEntry[] = entries
  .map((entry, index) => ({
    id: `0192f3c0-0000-7000-8000-${(0xe00 + index).toString(16).padStart(12, "0")}`,
    occurredAt: new Date(Date.UTC(2026, 10, 25, 8, index * 2, 5, 123)).toISOString(),
    organization: null,
    workingGroup: null,
    species: null,
    ...entry,
  }))
  .reverse();
