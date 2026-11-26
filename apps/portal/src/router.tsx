import type { RouteObject } from "react-router";
import { RouteCrash } from "./layout/crash";
import { PortalLayout } from "./layout/portal-layout";
import { RequireAdminRole } from "./layout/require-admin-role";
import { RequirePlatformAdmin } from "./layout/require-platform-admin";
import { AuditLogPage } from "./pages/audit-log-page";
import { DeleteAccountPage } from "./pages/delete-account-page";
import { HomePage } from "./pages/home-page";
import { MembershipRequestsPage } from "./pages/membership-requests-page";
import { NotFoundPage } from "./pages/not-found-page";
import { OrganizationPage } from "./pages/organization-page";
import { OrganizationsPage } from "./pages/organizations-page";
import { PasskeysPage } from "./pages/passkeys-page";
import { PlatformAdminsPage } from "./pages/platform-admins-page";
import { ProfilePage } from "./pages/profile-page";
import { SpeciesPage } from "./pages/species-page";
import { SystemPage } from "./pages/system-page";
import { WorkingGroupPage } from "./pages/working-group-page";
import { WorkingGroupsPage } from "./pages/working-groups-page";

/** Throws while rendering: the crash for the end-to-end tests of the crash screen. */
function DevCrash(): never {
  throw new Error("A crash on purpose, for the end-to-end test of the crash screen");
}

/** Under the dev server only, the path that crashes outside the router (see `main.tsx`). */
const devCrashOutsideRouterPath = "/dev/crash-outside-router";

/**
 * Whether this address should crash outside the router, around the login gate: the crash before
 * login of the end-to-end tests. Never in a build.
 */
export function isDevCrashOutsideRouter(pathname: string, dev: boolean = import.meta.env.DEV) {
  return dev && pathname === devCrashOutsideRouterPath;
}

/**
 * The route table. A crash in a page shows the crash screen in place of the whole portal. With
 * `dev` (the dev server), `/dev/crash` crashes while rendering, for the end-to-end tests.
 */
export function buildRoutes({ dev }: { dev: boolean }): RouteObject[] {
  return [
    {
      element: <PortalLayout />,
      errorElement: <RouteCrash />,
      children: [...(dev ? [{ path: "dev/crash", element: <DevCrash /> }] : []), ...pages],
    },
  ];
}

const pages: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: "working-groups", element: <WorkingGroupsPage /> },
  { path: "working-groups/:workingGroupId", element: <WorkingGroupPage /> },
  { path: "membership-requests", element: <MembershipRequestsPage /> },
  { path: "organizations", element: <OrganizationsPage /> },
  { path: "organizations/:organizationId", element: <OrganizationPage /> },
  {
    path: "species",
    element: (
      <RequirePlatformAdmin>
        <SpeciesPage />
      </RequirePlatformAdmin>
    ),
  },
  { path: "audit-log", element: <AuditLogPage /> },
  {
    path: "platform-admins",
    element: (
      <RequirePlatformAdmin>
        <PlatformAdminsPage />
      </RequirePlatformAdmin>
    ),
  },
  {
    path: "delete-account",
    element: (
      <RequirePlatformAdmin>
        <DeleteAccountPage />
      </RequirePlatformAdmin>
    ),
  },
  {
    path: "system",
    element: (
      <RequirePlatformAdmin>
        <SystemPage />
      </RequirePlatformAdmin>
    ),
  },
  { path: "profile", element: <ProfilePage /> },
  {
    path: "profile/passkeys",
    element: (
      <RequireAdminRole>
        <PasskeysPage />
      </RequireAdminRole>
    ),
  },
  { path: "*", element: <NotFoundPage /> },
];

export const routes = buildRoutes({ dev: import.meta.env.DEV });
