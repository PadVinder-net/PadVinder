import type { RouteObject } from "react-router";
import { PortalLayout } from "./layout/portal-layout";
import { RequirePlatformAdmin } from "./layout/require-platform-admin";
import { AuditLogPage } from "./pages/audit-log-page";
import { DeleteAccountPage } from "./pages/delete-account-page";
import { HomePage } from "./pages/home-page";
import { MembershipRequestsPage } from "./pages/membership-requests-page";
import { NotFoundPage } from "./pages/not-found-page";
import { OrganizationPage } from "./pages/organization-page";
import { OrganizationsPage } from "./pages/organizations-page";
import { PlatformAdminsPage } from "./pages/platform-admins-page";
import { SpeciesPage } from "./pages/species-page";
import { SystemPage } from "./pages/system-page";
import { WorkingGroupPage } from "./pages/working-group-page";
import { WorkingGroupsPage } from "./pages/working-groups-page";

export const routes: RouteObject[] = [
  {
    element: <PortalLayout />,
    children: [
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
