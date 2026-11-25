import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { dismissAllToasts, showToast, Toaster } from "./toast";

test("showToast shows the message in the Toaster", async () => {
  render(<Toaster />);
  act(() => showToast("Soort bewaard."));
  expect(await screen.findByText("Soort bewaard.")).toBeInTheDocument();
});

test("after dismissAllToasts, a new Toaster does not show the old toasts", async () => {
  render(<Toaster />);
  act(() => showToast("Oude melding."));
  expect(await screen.findByText("Oude melding.")).toBeInTheDocument();
  cleanup();
  dismissAllToasts();
  render(<Toaster />);
  act(() => showToast("Nieuwe melding."));
  expect(await screen.findByText("Nieuwe melding.")).toBeInTheDocument();
  expect(screen.queryByText("Oude melding.")).toBeNull();
});

test("the toast region has a Dutch name", () => {
  render(<Toaster />);
  // Sonner adds its keyboard shortcut to the name, so a screen reader hears "Meldingen alt+T".
  const region = screen.getByRole("region", { name: /^Meldingen/ });
  expect(region).toBeInTheDocument();
  expect(region).not.toHaveAccessibleName(/Notifications/);
});
