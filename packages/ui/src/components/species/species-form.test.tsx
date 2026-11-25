import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SpeciesForm, type SpeciesFormProps } from "./species-form";

function setup(props: Partial<SpeciesFormProps> = {}) {
  const onSubmit = vi.fn();
  render(<SpeciesForm mode="create" pending={false} onSubmit={onSubmit} {...props} />);
  return onSubmit;
}

const dutch = () => screen.getByRole("textbox", { name: "Nederlandse naam" });
const scientific = () => screen.getByRole("textbox", { name: "Wetenschappelijke naam" });
const save = () => screen.getByRole("button", { name: "Bewaar" });

test("the form trims and submits the three values", async () => {
  const onSubmit = setup();
  expect(
    screen.getByText('Schrijf de naam zoals in een zin, bijvoorbeeld "gewone pad".'),
  ).toBeVisible();
  expect(screen.getByText("Voor zeldzame of beschermde soorten.")).toBeVisible();
  await userEvent.type(dutch(), "  vuursalamander ");
  await userEvent.type(scientific(), " Salamandra salamandra  ");
  await userEvent.click(screen.getByRole("checkbox", { name: "Betrouwbaarheidscheck nodig" }));
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({
    dutchName: "vuursalamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
  });
});

test("an empty name shows the text and does not submit", async () => {
  const onSubmit = setup();
  await userEvent.type(dutch(), "   ");
  await userEvent.click(save());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
    "Vul een naam in.",
    "Vul een naam in.",
  ]);
});

test("a name of 101 characters shows the text and does not submit", async () => {
  const onSubmit = setup();
  await userEvent.type(dutch(), "a".repeat(101));
  await userEvent.type(scientific(), "Bufo bufo");
  await userEvent.click(save());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Een naam mag hoogstens honderd tekens hebben.",
  );
});

test("a name with an @ shows the text and does not submit", async () => {
  const onSubmit = setup();
  await userEvent.type(dutch(), "pad@home");
  await userEvent.type(scientific(), "Bufo bufo");
  await userEvent.click(save());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Een naam mag geen @ bevatten.");
});

test("edit mode starts with the initial values and shows the note", async () => {
  const onSubmit = setup({
    mode: "edit",
    initial: {
      dutchName: "kamsalamander",
      scientificName: "Triturus cristatus",
      needsVerification: true,
    },
  });
  expect(
    screen.getByText(
      "Wijzig een naam alleen om een fout te herstellen. Voeg voor een andere soort een nieuwe soort toe.",
    ),
  ).toBeVisible();
  expect(dutch()).toHaveValue("kamsalamander");
  expect(scientific()).toHaveValue("Triturus cristatus");
  expect(screen.getByRole("checkbox", { name: "Betrouwbaarheidscheck nodig" })).toBeChecked();
  await userEvent.click(save());
  expect(onSubmit).toHaveBeenCalledWith({
    dutchName: "kamsalamander",
    scientificName: "Triturus cristatus",
    needsVerification: true,
  });
});

test("a field error shows under its field and an error above the button", () => {
  setup({
    fieldErrors: { dutchName: "Er is al een soort met deze Nederlandse naam." },
    error: "Het lukt nu niet.",
  });
  expect(dutch()).toHaveAccessibleDescription("Er is al een soort met deze Nederlandse naam.");
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
});

test("while pending the button says Even geduld… and is disabled", () => {
  setup({ pending: true });
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});
