import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { WorkingGroupForm, type WorkingGroupFormProps } from "./working-group-form";

const one = [{ id: "org-1", name: "Paddentrek Voorbeeldstad" }];
const two = [...one, { id: "org-2", name: "Paddenwerkgroep Fictiefdorp" }];

function setup(props: Partial<WorkingGroupFormProps> = {}) {
  const onSubmit = vi.fn();
  render(
    <WorkingGroupForm
      mode="create"
      organizations={one}
      ownEmail="hoofdbeheerder@example.test"
      pending={false}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return onSubmit;
}

const name = () => screen.getByRole("textbox", { name: "Naam" });
const city = () => screen.getByRole("textbox", { name: "Plaats" });
const coordinator = () => screen.getByRole("textbox", { name: "E-mailadres van de coördinator" });
const save = () => screen.getByRole("button", { name: "Bewaar" });

test("the form starts with the own address and submits the trimmed values", async () => {
  const onSubmit = setup();
  expect(coordinator()).toHaveValue("hoofdbeheerder@example.test");
  expect(
    screen.getByText(
      "Deze persoon wordt de eerste coördinator. Je kunt je eigen adres laten staan.",
    ),
  ).toBeVisible();
  await userEvent.type(name(), "  Noord ");
  await userEvent.type(city(), " Voorbeeldstad  ");
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({
    organizationId: "org-1",
    name: "Noord",
    city: "Voorbeeldstad",
    coordinatorEmail: "hoofdbeheerder@example.test",
  });
});

test("with one organization there is no select and its id is submitted", async () => {
  const onSubmit = setup();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText("Paddentrek Voorbeeldstad")).toBeVisible();
  await userEvent.type(name(), "Noord");
  await userEvent.type(city(), "Voorbeeldstad");
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
});

test("with several organizations a select starts on the first", async () => {
  const onSubmit = setup({ organizations: two });
  expect(screen.getByRole("combobox", { name: "Organisatie" })).toHaveTextContent(
    "Paddentrek Voorbeeldstad",
  );
  await userEvent.type(name(), "Dorp");
  await userEvent.type(city(), "Fictiefdorp");
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
});

test.each([
  ["", "Voorbeeldstad", "hoofdbeheerder@example.test", ["Vul een naam in."]],
  ["Noord", "", "hoofdbeheerder@example.test", ["Vul een plaats in."]],
  ["Noord@", "Stad", "hoofdbeheerder@example.test", ["Een naam mag geen @ bevatten."]],
  ["Noord", "Stad@", "hoofdbeheerder@example.test", ["Een plaats mag geen @ bevatten."]],
  [
    "x".repeat(101),
    "Stad",
    "hoofdbeheerder@example.test",
    ["Een naam mag hoogstens honderd tekens hebben."],
  ],
  [
    "Noord",
    "x".repeat(101),
    "hoofdbeheerder@example.test",
    ["Een plaats mag hoogstens honderd tekens hebben."],
  ],
  ["Noord", "Stad", "jan@", ["Vul een geldig e-mailadres in."]],
])("%j, %j, %j shows its text and does not submit", async (n, c, email, texts) => {
  const onSubmit = setup({ ownEmail: "" });
  if (n) await userEvent.type(name(), n);
  if (c) await userEvent.type(city(), c);
  await userEvent.type(coordinator(), email);
  await userEvent.click(save());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(texts);
});

test("edit mode has no organization and no coordinator field and submits an empty address", async () => {
  const onSubmit = setup({ mode: "edit", initial: { name: "Noord", city: "Stad" } });
  expect(screen.queryByRole("textbox", { name: /coördinator/ })).toBeNull();
  expect(screen.queryByText("Organisatie")).toBeNull();
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({
    organizationId: "org-1",
    name: "Noord",
    city: "Stad",
    coordinatorEmail: "",
  });
});

test("a field error from the server shows under its field; pending disables the button", () => {
  setup({
    pending: true,
    fieldErrors: { name: "Er is al een werkgroep met deze naam." },
    error: "Het lukt nu niet.",
  });
  expect(screen.getByRole("textbox", { name: "Naam" })).toHaveAccessibleDescription(
    "Er is al een werkgroep met deze naam.",
  );
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});

test("markup in a name is shown as text", () => {
  setup({ mode: "edit", initial: { name: "<b>Noord</b>", city: "Stad" } });
  expect(name()).toHaveValue("<b>Noord</b>");
  expect(document.querySelector("b")).toBeNull();
});
