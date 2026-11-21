import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { routes } from "../router";

test("home page links to the system status", () => {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />);
  expect(screen.getByRole("heading", { level: 1, name: "PadVinder" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Systeemstatus" })).toHaveAttribute("href", "/system");
});
