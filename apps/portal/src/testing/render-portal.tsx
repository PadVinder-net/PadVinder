import { createTestQueryClient } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthGate } from "../auth/auth-gate";
import { routes } from "../router";

/** The whole portal as `main.tsx` mounts it, at `path`, with a memory router. */
export function renderPortal(path = "/", client = createTestQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </QueryClientProvider>,
  );
  return { router, client };
}
