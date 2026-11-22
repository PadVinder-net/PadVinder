import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { WaitingForApproval } from "./waiting-for-approval";

function setup(pending = false) {
  const handlers = { onWithdraw: vi.fn(), onLogOut: vi.fn(), onOpenProfile: vi.fn() };
  render(<WaitingForApproval workingGroupName="Noord" pending={pending} {...handlers} />);
  return handlers;
}

test("shows the welcome text", () => {
  setup();
  expect(screen.getByRole("heading", { name: "Welkom!" })).toBeVisible();
  expect(
    screen.getByText(
      "De coördinator van Noord neemt contact met je op om kennis te maken. Dat kan een paar dagen duren.",
    ),
  ).toBeVisible();
});
test("withdrawing asks first; Annuleer does nothing; confirming calls onWithdraw once", async () => {
  const { onWithdraw } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Trek aanmelding in" }));
  const dialog = screen.getByRole("alertdialog", { name: "Aanmelding intrekken?" });
  expect(dialog).toHaveTextContent("Je kunt daarna een andere werkgroep kiezen.");
  await userEvent.click(screen.getByRole("button", { name: "Annuleer" }));
  expect(onWithdraw).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Trek aanmelding in" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Trek aanmelding in" }),
  );
  expect(onWithdraw).toHaveBeenCalledOnce();
});
test("log out and profile call their handlers", async () => {
  const { onLogOut, onOpenProfile } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Log uit" }));
  await userEvent.click(screen.getByRole("button", { name: "Profiel" }));
  expect(onLogOut).toHaveBeenCalledOnce();
  expect(onOpenProfile).toHaveBeenCalledOnce();
});
