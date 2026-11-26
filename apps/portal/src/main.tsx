import { createQueryClient } from "@padvinder/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthGate } from "./auth/auth-gate";
import { routes } from "./router";
import { appUrlForThisBrowser } from "./send-to-app";
import "./index.css";

// A link meant for the other app goes there before anything renders, so before any login.
const forwardTo = appUrlForThisBrowser();
if (forwardTo) {
  window.location.replace(forwardTo);
} else {
  const queryClient = createQueryClient();
  const router = createBrowserRouter(routes);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthGate onLoggedOut={() => void router.navigate("/", { replace: true })}>
          <RouterProvider router={router} />
        </AuthGate>
      </QueryClientProvider>
    </StrictMode>,
  );
}
