import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { OrganizationForm, type OrganizationFormProps } from "./organization-form";

function setup(props: Partial<OrganizationFormProps> = {}) {
  const onSubmit = vi.fn();
  render(
    <OrganizationForm mode="create" canRename pending={false} onSubmit={onSubmit} {...props} />,
  );
  return onSubmit;
}

const name = () => screen.getByRole("textbox", { name: "Naam" });
const contact = () => screen.getByRole("textbox", { name: "Contactadres" });
const admin = () => screen.getByRole("textbox", { name: "E-mailadres van de beheerder" });
const save = () => screen.getByRole("button", { name: "Bewaar" });

test("the form shows its hints and submits trimmed values; an empty contact address is null", async () => {
  const onSubmit = setup();
  expect(
    screen.getByText(
      "Het adres waar leden terechtkunnen als er iets niet klopt. Mag leeg blijven.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("Heeft deze persoon nog geen account? Dan wordt het aangemaakt."),
  ).toBeVisible();
  await userEvent.type(name(), "  Paddentrek Nieuwstad ");
  await userEvent.type(admin(), " beheer@example.test ");
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({
    name: "Paddentrek Nieuwstad",
    contactEmail: null,
    adminEmail: "beheer@example.test",
  });
});

test("a given contact address is submitted trimmed", async () => {
  const onSubmit = setup();
  await userEvent.type(name(), "Nieuw");
  await userEvent.type(contact(), " info@example.test ");
  await userEvent.type(admin(), "beheer@example.test");
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ contactEmail: "info@example.test" }),
  );
});

test.each([
  ["", "", "beheer@example.test", ["Vul een naam in."]],
  ["Een@naam", "", "beheer@example.test", ["Een naam mag geen @ bevatten."]],
  ["x".repeat(101), "", "beheer@example.test", ["Een naam mag hoogstens honderd tekens hebben."]],
  ["Nieuw", "jan@", "beheer@example.test", ["Vul een geldig e-mailadres in."]],
  ["Nieuw", "", "jan@", ["Vul een geldig e-mailadres in."]],
  ["Nieuw", "", "", ["Vul een geldig e-mailadres in."]],
])("%j, %j, %j shows its text and does not submit", async (n, c, a, texts) => {
  const onSubmit = setup();
  if (n) await userEvent.type(name(), n);
  if (c) await userEvent.type(contact(), c);
  if (a) await userEvent.type(admin(), a);
  await userEvent.click(save());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getAllByRole("alert").map((x) => x.textContent)).toEqual(texts);
});

test("edit mode has no admin field and submits an empty admin address", async () => {
  const onSubmit = setup({
    mode: "edit",
    initial: { name: "Paddentrek", contactEmail: "info@example.test" },
  });
  expect(screen.queryByRole("textbox", { name: "E-mailadres van de beheerder" })).toBeNull();
  expect(contact()).toHaveValue("info@example.test");
  await userEvent.clear(contact());
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({ name: "Paddentrek", contactEmail: null, adminEmail: "" });
});

test("edit mode without canRename shows the name as text and submits it unchanged", async () => {
  const onSubmit = setup({
    mode: "edit",
    canRename: false,
    initial: { name: "Paddentrek", contactEmail: null },
  });
  expect(screen.queryByRole("textbox", { name: "Naam" })).toBeNull();
  expect(screen.getByText("Paddentrek")).toBeVisible();
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({ name: "Paddentrek", contactEmail: null, adminEmail: "" });
});

test("field errors from the server show under their fields", () => {
  setup({
    fieldErrors: {
      name: "Er is al een organisatie met deze naam.",
      adminEmail: "Vul een geldig e-mailadres in.",
    },
    error: "Het lukt nu niet.",
  });
  expect(name()).toHaveAccessibleDescription("Er is al een organisatie met deze naam.");
  expect(admin()).toHaveAccessibleDescription(
    "Heeft deze persoon nog geen account? Dan wordt het aangemaakt. Vul een geldig e-mailadres in.",
  );
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
});

test("pending disables the button", () => {
  setup({ pending: true });
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});

test("markup in a name is shown as text", () => {
  setup({
    mode: "edit",
    canRename: false,
    initial: { name: "<b>Paddentrek</b>", contactEmail: null },
  });
  expect(screen.getByText("<b>Paddentrek</b>")).toBeVisible();
  expect(document.querySelector("b")).toBeNull();
});
