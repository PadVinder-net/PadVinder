import { useMe } from "@padvinder/api-client";
import type { ReactNode } from "react";
import { NotFoundPage } from "../pages/not-found-page";
import { managesSomething } from "./navigation";

/**
 * Renders `children` only for someone who manages something (`managesSomething`); anyone else sees
 * the not-found page. Follows me, as `RequirePlatformAdmin` does.
 */
export function RequireManagesSomething({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data || !managesSomething(me.data)) return <NotFoundPage />;
  return children;
}
