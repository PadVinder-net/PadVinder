import type { RouteObject } from "react-router";
import { AppLayout } from "./app";
import { RouteCrash } from "./components/crash";
import { JoinAnotherScreen } from "./screens/more/join-another-screen";
import { MapScreen } from "./screens/map-screen";
import { MoreScreen } from "./screens/more-screen";
import { NotFoundScreen } from "./screens/not-found-screen";
import { MemberScreen } from "./screens/more/member-screen";
import { MembersScreen } from "./screens/more/members-screen";
import { MembershipRequestScreen } from "./screens/more/membership-request-screen";
import { MembershipRequestsScreen } from "./screens/more/membership-requests-screen";
import { ProfileScreen } from "./screens/more/profile-screen";
import { ReportProblemScreen } from "./screens/more/report-problem-screen";
import { SystemScreen } from "./screens/more/system-screen";
import { ResultsScreen } from "./screens/results-screen";
import { TonightScreen } from "./screens/tonight-screen";

/**
 * The app is served under /app/ and the installed PWA's scope is /app/: do not change this.
 * The trailing slash matters: with "/app", the link to "/" becomes "/app", which is outside the scope.
 */
export const appBasename = "/app/";

/** Throws while rendering: the crash for the end-to-end tests of the crash screen. */
function DevCrash(): never {
  throw new Error("A crash on purpose, for the end-to-end test of the crash screen");
}

/** Under the dev server only, the path that crashes outside the router (see `main.tsx`). */
const devCrashOutsideRouterPath = `${appBasename}dev/crash-outside-router`;

/**
 * Whether this address should crash outside the router, around the login gate: the crash before
 * login of the end-to-end tests. Never in a build.
 */
export function isDevCrashOutsideRouter(pathname: string, dev: boolean = import.meta.env.DEV) {
  return dev && pathname === devCrashOutsideRouterPath;
}

/**
 * The route table. A crash in a screen shows the crash screen in place of the whole app. With
 * `dev` (the dev server), `/app/dev/crash` crashes while rendering, for the end-to-end tests.
 */
export function buildRoutes({ dev }: { dev: boolean }): RouteObject[] {
  return [
    {
      element: <AppLayout />,
      errorElement: <RouteCrash />,
      children: [...(dev ? [{ path: "dev/crash", element: <DevCrash /> }] : []), ...screens],
    },
  ];
}

const screens: RouteObject[] = [
  { index: true, element: <TonightScreen /> },
  { path: "map", element: <MapScreen /> },
  { path: "results", element: <ResultsScreen /> },
  {
    // English paths, also for the screens a user sees in the address bar.
    path: "more",
    children: [
      { index: true, element: <MoreScreen /> },
      { path: "profile", element: <ProfileScreen /> },
      { path: "profile/join", element: <JoinAnotherScreen /> },
      // The link in the coordinator's mail points to one request.
      { path: "membership-requests", element: <MembershipRequestsScreen /> },
      { path: "membership-requests/:requestId", element: <MembershipRequestScreen /> },
      { path: "members", element: <MembersScreen /> },
      { path: "members/:membershipId", element: <MemberScreen /> },
      { path: "system", element: <SystemScreen /> },
      { path: "report-problem", element: <ReportProblemScreen /> },
    ],
  },
  // Inside the layout, so the tabs stay; the error element is for real crashes only.
  { path: "*", element: <NotFoundScreen /> },
];

export const routes = buildRoutes({ dev: import.meta.env.DEV });
