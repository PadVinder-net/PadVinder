import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Titel?"
      text="Uitleg."
      confirmLabel="Doe het"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

test("shows title and text; confirm calls once", async () => {
  const { onConfirm } = setup();
  expect(screen.getByRole("alertdialog", { name: "Titel?" })).toHaveTextContent("Uitleg.");
  await userEvent.click(screen.getByRole("button", { name: "Doe het" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
test("Annuleer and Escape cancel", async () => {
  const { onCancel, onConfirm } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Annuleer" }));
  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onConfirm).not.toHaveBeenCalled();
});
test("while pending the buttons are disabled", () => {
  setup({ pending: true });
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Annuleer" })).toBeDisabled();
});
test("renders nothing when closed", () => {
  setup({ open: false });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
