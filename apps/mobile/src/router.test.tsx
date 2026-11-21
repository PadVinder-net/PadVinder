import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { appBasename, routes } from "./router";

vi.mock("./hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

function renderAt(path: string) {
  render(
    <RouterProvider
      router={createMemoryRouter(routes, { basename: appBasename, initialEntries: [path] })}
    />,
  );
}

test("tab links stay inside the /app/ scope", () => {
  renderAt("/app/");
  expect(screen.getByRole("link", { name: "Vanavond" })).toHaveAttribute("href", "/app/");
  expect(screen.getByRole("link", { name: "Kaart" })).toHaveAttribute("href", "/app/map");
  expect(screen.getByRole("link", { name: "Resultaten" })).toHaveAttribute("href", "/app/results");
  expect(screen.getByRole("link", { name: "Meer" })).toHaveAttribute("href", "/app/more");
});

test("routes match under the basename", () => {
  renderAt("/app/");
  expect(screen.getByRole("heading", { level: 1, name: "Vanavond" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Vanavond" })).toHaveAttribute("aria-current", "page");
});

test("the Kaart route matches", () => {
  renderAt("/app/map");
  expect(screen.getByRole("heading", { level: 1, name: "Kaart" })).toBeVisible();
});
