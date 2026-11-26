import { useMe } from "@padvinder/api-client";
import type { MeResponse } from "@padvinder/contracts";
import type { ReactNode } from "react";
import { NotFoundPage } from "../pages/not-found-page";

/** A platform admin or an admin of at least one organization: who has passkeys. */
export function hasAdminRole(me: MeResponse): boolean {
  return me.user.isPlatformAdmin || me.organizationAdminOf.length > 0;
}

/**
 * Renders `children` only for someone with an admin role; anyone else sees the not-found page.
 * Follows me, so a page turns into the not-found page when the role goes.
 */
export function RequireAdminRole({ children }: { children: ReactNode }) {
  const me = useMe().data;
  if (!me || !hasAdminRole(me)) return <NotFoundPage />;
  return children;
}
