import { createQueryClient } from "@padvinder/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthGate } from "./auth/auth-gate";
import { VersionGate } from "./components/version-gate";
import { appBasename, routes } from "./router";
import "./index.css";

const queryClient = createQueryClient();
const router = createBrowserRouter(routes, { basename: appBasename });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VersionGate>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </VersionGate>
    </QueryClientProvider>
  </StrictMode>,
);
