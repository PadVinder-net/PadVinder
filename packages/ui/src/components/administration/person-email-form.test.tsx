import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PersonEmailForm, type PersonEmailFormProps } from "./person-email-form";

function setup(props: Partial<PersonEmailFormProps> = {}) {
  const onSubmit = vi.fn();
  render(
    <PersonEmailForm submitLabel="Maak beheerder" pending={false} onSubmit={onSubmit} {...props} />,
  );
  return onSubmit;
}

const field = () => screen.getByRole("textbox", { name: "E-mailadres" });

test("submits the trimmed address", async () => {
  const onSubmit = setup({ hint: "Een hint." });
  expect(screen.getByText("Een hint.")).toBeVisible();
  await userEvent.type(field(), " Nieuw@Example.test ");
  await userEvent.click(screen.getByRole("button", { name: "Maak beheerder" }));
  expect(onSubmit).toHaveBeenCalledWith("Nieuw@Example.test");
});

test.each(["", "jan@", "geen adres"])("%j shows the text and does not submit", async (text) => {
  const onSubmit = setup();
  if (text) await userEvent.type(field(), text);
  await userEvent.click(screen.getByRole("button", { name: "Maak beheerder" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Vul een geldig e-mailadres in.");
});

test("server messages show and pending disables", () => {
  setup({
    fieldError: "Deze persoon heeft al een account.",
    error: "Het lukt nu niet.",
    pending: true,
  });
  expect(field()).toHaveAccessibleDescription("Deze persoon heeft al een account.");
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});
