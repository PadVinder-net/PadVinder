import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { UpdatePrompt } from "./update-prompt";

const state = vi.hoisted(() => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }));
vi.mock("../hooks/use-service-worker", () => ({ useServiceWorker: () => state }));

test("shows nothing without a waiting version", () => {
  state.needRefresh = false;
  render(<UpdatePrompt />);
  expect(screen.queryByText("Er is een nieuwe versie.")).toBeNull();
});

test("offers the update when a new version waits", async () => {
  state.needRefresh = true;
  render(<UpdatePrompt />);
  expect(screen.getByText("Er is een nieuwe versie.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Werk de app bij" }));
  expect(state.applyUpdate).toHaveBeenCalledOnce();
});

test("shows progress and disables the button while updating", () => {
  state.needRefresh = true;
  state.checking = true;
  render(<UpdatePrompt />);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  state.checking = false;
});
