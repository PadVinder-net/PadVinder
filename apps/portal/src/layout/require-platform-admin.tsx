import { useMe } from "@padvinder/api-client";
import type { ReactNode } from "react";
import { NotFoundPage } from "../pages/not-found-page";

/**
 * Renders `children` only for a platform admin; anyone else sees the not-found page, so a page
 * they may not see looks like one that does not exist. Follows me: when the flag goes, an open
 * page turns into the not-found page.
 */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data?.user.isPlatformAdmin) return <NotFoundPage />;
  return children;
}
