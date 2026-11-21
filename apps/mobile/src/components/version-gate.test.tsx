import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { createTestQueryClient, mockFetch, mockPendingFetch } from "@padvinder/api-client/testing";
import { VersionGate } from "./version-gate";

const state = vi.hoisted(() => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }));
vi.mock("../hooks/use-service-worker", () => ({ useServiceWorker: () => state }));

beforeEach(() => {
  state.checking = false;
  state.applyUpdate.mockReset();
});

/** Renders the gate and returns a promise that resolves once the version request has settled. */
function renderGate() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <VersionGate>
        <p>inhoud</p>
      </VersionGate>
    </QueryClientProvider>,
  );
  return async () => {
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(1));
  };
}

test("version gate blocks an outdated app", async () => {
  mockFetch({ "/api/version": { minimumAppVersion: "2099.0.0", commit: "x" } });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Werk de app bij" })).toBeVisible();
  expect(screen.getByText(/Er is een nieuwe versie van PadVinder/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Werk de app bij" })).toBeVisible();
  expect(screen.queryByText("inhoud")).toBeNull();
});

test("the update button starts the update and shows progress while checking", async () => {
  mockFetch({ "/api/version": { minimumAppVersion: "2099.0.0", commit: "x" } });
  state.checking = false;
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: "Werk de app bij" }));
  expect(state.applyUpdate).toHaveBeenCalledOnce();
  state.checking = true;
  cleanup();
  renderGate();
  expect(await screen.findByRole("button", { name: "Even geduld…" })).toBeDisabled();
  state.checking = false;
});

test("version gate shows the app while the version is still loading", () => {
  mockPendingFetch();
  renderGate();
  expect(screen.getByText("inhoud")).toBeVisible();
});

test("version gate lets a current app through", async () => {
  const { calls } = mockFetch({ "/api/version": { minimumAppVersion: "2027.0.0", commit: "x" } });
  const settled = renderGate();
  await settled();
  expect(calls).toHaveLength(1);
  expect(screen.getByText("inhoud")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Werk de app bij" })).toBeNull();
});

test("version gate lets the app through when the API fails", async () => {
  const { calls } = mockFetch({});
  const settled = renderGate();
  await settled();
  expect(calls).toHaveLength(1);
  expect(screen.getByText("inhoud")).toBeVisible();
});

test("version gate lets the app through on a malformed version", async () => {
  const { calls } = mockFetch({ "/api/version": { minimumAppVersion: "nope", commit: "x" } });
  const settled = renderGate();
  await settled();
  expect(calls).toHaveLength(1);
  expect(screen.getByText("inhoud")).toBeVisible();
});
