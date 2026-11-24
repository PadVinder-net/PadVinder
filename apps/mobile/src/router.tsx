import type { RouteObject } from "react-router";
import { AppLayout } from "./app";
import { MapScreen } from "./screens/map-screen";
import { MoreScreen } from "./screens/more-screen";
import { MemberScreen } from "./screens/more/member-screen";
import { MembersScreen } from "./screens/more/members-screen";
import { MembershipRequestScreen } from "./screens/more/membership-request-screen";
import { MembershipRequestsScreen } from "./screens/more/membership-requests-screen";
import { ProfileScreen } from "./screens/more/profile-screen";
import { SystemScreen } from "./screens/more/system-screen";
import { ResultsScreen } from "./screens/results-screen";
import { TonightScreen } from "./screens/tonight-screen";

/**
 * The app is served under /app/ and the installed PWA's scope is /app/: do not change this.
 * The trailing slash matters: with "/app", the link to "/" becomes "/app", which is outside the scope.
 */
export const appBasename = "/app/";

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <TonightScreen /> },
      { path: "map", element: <MapScreen /> },
      { path: "results", element: <ResultsScreen /> },
      {
        // English paths, also for the screens a user sees in the address bar.
        path: "more",
        children: [
          { index: true, element: <MoreScreen /> },
          { path: "profile", element: <ProfileScreen /> },
          // The link in the coordinator's mail points to one request.
          { path: "membership-requests", element: <MembershipRequestsScreen /> },
          { path: "membership-requests/:requestId", element: <MembershipRequestScreen /> },
          { path: "members", element: <MembersScreen /> },
          { path: "members/:membershipId", element: <MemberScreen /> },
          { path: "system", element: <SystemScreen /> },
        ],
      },
    ],
  },
];
