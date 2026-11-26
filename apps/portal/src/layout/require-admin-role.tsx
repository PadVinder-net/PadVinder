import { hasAdminRole, useMe } from "@padvinder/api-client";
import type { ReactNode } from "react";
import { NotFoundPage } from "../pages/not-found-page";

/**
 * Renders `children` only for someone with an admin role; anyone else sees the not-found page.
 * Follows me, so a page turns into the not-found page when the role goes.
 */
export function RequireAdminRole({ children }: { children: ReactNode }) {
  const me = useMe().data;
  if (!me || !hasAdminRole(me)) return <NotFoundPage />;
  return children;
}
