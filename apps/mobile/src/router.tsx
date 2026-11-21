import type { RouteObject } from "react-router";
import { AppLayout } from "./app";
import { MapScreen } from "./screens/map-screen";
import { MoreScreen } from "./screens/more-screen";
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
      { path: "more", element: <MoreScreen /> },
    ],
  },
];
