import { createTestQueryClient } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthGate } from "../auth/auth-gate";
import { appBasename, routes } from "../router";

/**
 * Renders the whole app as `main.tsx` does, at `path` (with the /app/ basename): the gate around
 * the router. Test files mock `../hooks/use-service-worker` themselves (vi.mock is per file).
 */
export function renderApp(path: string, client = createTestQueryClient()) {
  const router = createMemoryRouter(routes, { basename: appBasename, initialEntries: [path] });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </QueryClientProvider>,
  );
  return { client, router, unmount };
}

/** An error body of our API. */
/** An error answer of our API; `extra` adds keys, such as the `blockers` of a blocked deletion. */
export function errorResponse(status: number, code: string, extra: Record<string, unknown> = {}) {
  return Response.json(
    { statusCode: status, error: "Error", message: "x", code, ...extra },
    { status },
  );
}

export const notLoggedIn = () => errorResponse(401, "not_logged_in");
