import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PasskeyModal, type PasskeyModalProps } from "./passkey-modal";

function setup(props: Partial<PasskeyModalProps> = {}) {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn(), onLogInAgain: vi.fn() };
  render(<PasskeyModal open hasPasskey pending={false} error={null} {...handlers} {...props} />);
  return handlers;
}

test("the modal shows the passkey layout or the create layout by hasPasskey, with the design's texts", async () => {
  const { onConfirm, onCancel } = setup();
  expect(screen.getByRole("dialog", { name: "Bevestig dat jij het bent" })).toBeVisible();
  expect(screen.getByText("Voor beheer vraagt PadVinder om je toegangssleutel.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Gebruik je toegangssleutel" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Annuleer" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

test("without a passkey the modal offers to make one", () => {
  setup({ hasPasskey: false });
  expect(screen.getByRole("dialog", { name: "Maak een toegangssleutel" })).toBeVisible();
  expect(
    screen.getByText(
      "Voor beheer heb je een toegangssleutel nodig. Je telefoon of laptop bewaart hem en vraagt om je vingerafdruk, gezicht of pincode. Je maakt hem één keer.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Maak een toegangssleutel" })).toBeVisible();
});

test("the main button is disabled while pending, and Escape does not close it then", async () => {
  const { onCancel } = setup({ pending: true });
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Annuleer" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Sluiten" }));
  expect(onCancel).not.toHaveBeenCalled();
});

test("Escape closes it when nothing is pending", async () => {
  const { onCancel } = setup();
  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledOnce();
});

test("the error shows in an alert, and a cancelled try says to try again", () => {
  setup({ error: "cancelled" });
  expect(screen.getByRole("alert")).toHaveTextContent("Dat lukte niet. Probeer het nog eens.");
});

test("another account's passkey says so", () => {
  setup({ error: "other_account" });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Deze toegangssleutel hoort bij een ander account.",
  );
});

test("session_too_old shows Log opnieuw in in place of the main button", async () => {
  const { onLogInAgain } = setup({ hasPasskey: false, error: "session_too_old" });
  expect(screen.queryByRole("button", { name: "Maak een toegangssleutel" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Log opnieuw in" }));
  expect(onLogInAgain).toHaveBeenCalledOnce();
});
