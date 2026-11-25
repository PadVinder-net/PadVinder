import type { RouteObject } from "react-router";
import { PortalLayout } from "./layout/portal-layout";
import { RequirePlatformAdmin } from "./layout/require-platform-admin";
import { HomePage } from "./pages/home-page";
import { NotFoundPage } from "./pages/not-found-page";
import { SystemPage } from "./pages/system-page";

export const routes: RouteObject[] = [
  {
    element: <PortalLayout />,
    children: [
      { index: true, element: <HomePage /> },
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
