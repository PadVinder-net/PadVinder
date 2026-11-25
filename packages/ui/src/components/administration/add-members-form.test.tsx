import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AddMembersForm, type AddMembersFormProps } from "./add-members-form";

function setup(props: Partial<AddMembersFormProps> = {}) {
  const onSubmit = vi.fn();
  render(<AddMembersForm pending={false} onSubmit={onSubmit} {...props} />);
  return onSubmit;
}

const field = () => screen.getByRole("textbox", { name: "E-mailadressen" });
const button = () => screen.getByRole("button", { name: "Voeg toe" });
// Typing a long list key by key is slow; a paste is one change.
const paste = (text: string) => fireEvent.change(field(), { target: { value: text } });

test("the form shows the hint, and the button is disabled without an address", () => {
  setup();
  expect(screen.getByText("Eén adres per regel. Iedereen krijgt een mail.")).toBeVisible();
  expect(button()).toBeDisabled();
});

test("the form shows Regel 3: 'jan@' is geen geldig e-mailadres. and disables the button", () => {
  setup();
  paste("noor@example.test\n\njan@");
  expect(screen.getByText("Regel 3: 'jan@' is geen geldig e-mailadres.")).toBeVisible();
  expect(button()).toBeDisabled();
});

test("the form submits the right lines once every line is right", async () => {
  const onSubmit = setup();
  paste("noor@example.test\r\n Bram@Example.test \n");
  expect(button()).toBeEnabled();
  await userEvent.click(button());
  expect(onSubmit).toHaveBeenCalledWith(["noor@example.test", "Bram@Example.test"]);
});

test("201 different addresses show the text and disable the button; 201 lines of one address do not", () => {
  setup();
  const many = Array.from({ length: 201 }, (_, i) => `p${i}@example.test`).join("\n");
  paste(many);
  expect(screen.getByText("Voeg hoogstens tweehonderd adressen per keer toe.")).toBeVisible();
  expect(button()).toBeDisabled();
  paste(
    Array.from({ length: 201 }, (_, i) => (i % 2 ? "A@example.test" : " a@example.test")).join(
      "\n",
    ),
  );
  expect(screen.queryByText("Voeg hoogstens tweehonderd adressen per keer toe.")).toBeNull();
  expect(button()).toBeEnabled();
});

test("markup in a line is shown as text", () => {
  setup();
  paste("<b>jan</b>");
  expect(screen.getByText("Regel 1: '<b>jan</b>' is geen geldig e-mailadres.")).toBeVisible();
  expect(document.querySelector("b")).toBeNull();
});

test("pending disables the button and an error shows above it", () => {
  setup({ pending: true, error: "Het lukt nu niet." });
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});
