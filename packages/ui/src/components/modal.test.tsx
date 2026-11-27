import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Modal } from "./modal";

function setup(open = true) {
  const onClose = vi.fn();
  render(
    <Modal open={open} title="Soort wijzigen" onClose={onClose}>
      <p>Inhoud van het venster.</p>
      <button type="button">Bewaar</button>
    </Modal>,
  );
  return { onClose };
}

test("shows the title and the content", () => {
  setup();
  const dialog = screen.getByRole("dialog", { name: "Soort wijzigen" });
  expect(dialog).toHaveTextContent("Inhoud van het venster.");
  expect(screen.getByRole("button", { name: "Bewaar" })).toBeInTheDocument();
});

test.each([
  ["the cross", () => userEvent.click(screen.getByRole("button", { name: "Sluiten" }))],
  ["Escape", () => userEvent.keyboard("{Escape}")],
  [
    "a click beside it",
    () => userEvent.click(document.querySelector<HTMLElement>("[data-slot=dialog-overlay]")!),
  ],
])("closes by %s, calling onClose once", async (_way, close) => {
  const { onClose } = setup();
  await close();
  expect(onClose).toHaveBeenCalledOnce();
});

test("a click inside does not close it", async () => {
  const { onClose } = setup();
  await userEvent.click(screen.getByText("Inhoud van het venster."));
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(onClose).not.toHaveBeenCalled();
});

test("renders nothing when closed", () => {
  setup(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the cross is named Sluiten", () => {
  setup();
  expect(screen.getByRole("button", { name: "Sluiten" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});

test("on opening, focus is on the dialog itself, not on the cross; Tab reaches the cross first", async () => {
  setup();
  const dialog = screen.getByRole("dialog", { name: "Soort wijzigen" });
  expect(dialog).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Sluiten" })).toHaveFocus();
});
