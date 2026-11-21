import type { RouteObject } from "react-router";
import { HomePage } from "./pages/home-page";
import { SystemPage } from "./pages/system-page";

export const routes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: "system", element: <SystemPage /> },
];
