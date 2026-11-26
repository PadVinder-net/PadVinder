import type { MeResponse } from "@padvinder/contracts";

export type NavItem = { label: string; to: string };

/**
 * The portal's navigation items for this user, in the order of the navigation table in
 * `docs/superpowers/specs/2026-11-22-portal-administration-design.md` ("The portal"). Each item
 * shows only for who may use it; hiding is for convenience only, the API decides. Later plans add
 * their items here, in the table's order.
 */
export function navigationFor(me: MeResponse): NavItem[] {
  const items: NavItem[] = [];
  if (managesSomething(me)) {
    items.push({ label: "Werkgroepen", to: "/working-groups" });
    items.push({ label: "Aanmeldingen", to: "/membership-requests" });
  }
  const [onlyOrganization, ...otherOrganizations] = me.organizationAdminOf;
  if (me.user.isPlatformAdmin || otherOrganizations.length > 0) {
    items.push({ label: "Organisaties", to: "/organizations" });
  } else if (onlyOrganization) {
    // An admin of one organization goes straight to it.
    items.push({ label: "Organisatie", to: `/organizations/${onlyOrganization.id}` });
  }
  if (me.user.isPlatformAdmin) items.push({ label: "Soorten", to: "/species" });
  if (readsAuditLog(me)) items.push({ label: "Logboek", to: "/audit-log" });
  if (me.user.isPlatformAdmin) {
    items.push({ label: "Hoofdbeheerders", to: "/platform-admins" });
    items.push({ label: "Account verwijderen", to: "/delete-account" });
    items.push({ label: "Systeemstatus", to: "/system" });
  }
  return items;
}

/** A platform admin, an organization admin, or a coordinator of at least one working group. */
export function managesSomething(me: MeResponse): boolean {
  return (
    me.user.isPlatformAdmin ||
    me.organizationAdminOf.length > 0 ||
    me.memberships.some((membership) => membership.isCoordinator)
  );
}

/** A platform admin, or an admin of at least one organization: who may read the audit log. */
export function readsAuditLog(me: MeResponse): boolean {
  return me.user.isPlatformAdmin || me.organizationAdminOf.length > 0;
}
