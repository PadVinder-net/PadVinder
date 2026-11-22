import {
  applicantMeFixture,
  meFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ProfileForm } from "./profile-form";

function setup(me: MeResponse = meFixture, extra: { saved?: boolean; error?: string } = {}) {
  const handlers = { onSave: vi.fn(), onDelete: vi.fn() };
  render(<ProfileForm me={me} saving={false} deleting={false} {...extra} {...handlers} />);
  return handlers;
}

test("the profile shows the email address as text and saves name and phone", async () => {
  const { onSave } = setup();
  expect(screen.getByRole("heading", { name: "Profiel" })).toBeVisible();
  expect(screen.getByText("noor@example.test")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "E-mailadres" })).toBeNull();
  const name = screen.getByRole("textbox", { name: "Naam" });
  expect(name).toHaveValue("Noor de Vries");
  await userEvent.clear(name);
  await userEvent.type(name, "  Noor Bakker ");
  await userEvent.type(screen.getByRole("textbox", { name: "Telefoonnummer (mag leeg)" }), "06 1");
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(onSave).toHaveBeenCalledWith({ name: "Noor Bakker", phone: "06 1" });
});

test("an empty phone is saved as null and an empty name is refused", async () => {
  const { onSave } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(onSave).toHaveBeenCalledWith({ name: "Noor de Vries", phone: null });
  await userEvent.clear(screen.getByRole("textbox", { name: "Naam" }));
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("Vul je naam in.");
});

test("shows the saved message, or an error instead of it", () => {
  const { unmount } = render(
    <ProfileForm
      me={meFixture}
      onSave={() => {}}
      onDelete={() => {}}
      saving={false}
      deleting={false}
      saved
    />,
  );
  expect(screen.getByText("Je gegevens zijn bewaard.")).toBeVisible();
  unmount();
  setup(meFixture, { saved: true, error: "Het lukt nu niet." });
  expect(screen.queryByText("Je gegevens zijn bewaard.")).toBeNull();
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
});

test("lists the working groups, or says there are none", () => {
  const { unmount } = render(
    <ProfileForm
      me={twoOrganizationsMeFixture}
      onSave={() => {}}
      onDelete={() => {}}
      saving={false}
      deleting={false}
    />,
  );
  expect(screen.getByText("Noord, Paddentrek Voorbeeldstad")).toBeVisible();
  expect(screen.getByText("Centrum, Waterdieren Overstad")).toBeVisible();
  unmount();
  setup(applicantMeFixture);
  expect(screen.getByText("Je bent nog geen lid van een werkgroep.")).toBeVisible();
});

test("deleting the account asks first with the exact text", async () => {
  const { onDelete } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Verwijder account" }));
  const dialog = screen.getByRole("alertdialog", { name: "Account verwijderen?" });
  expect(dialog).toHaveTextContent(
    "Je naam, e-mailadres en telefoonnummer worden gewist. Wat je hebt geteld blijft bewaard, zonder je naam. Dit kun je niet terugdraaien.",
  );
  expect(onDelete).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder account" }));
  expect(onDelete).toHaveBeenCalledOnce();
});

test("the saved message is absent when saved is not set", () => {
  setup();
  expect(screen.queryByText("Je gegevens zijn bewaard.")).toBeNull();
});

test("the saved message goes away after an edit", async () => {
  setup(meFixture, { saved: true });
  expect(screen.getByText("Je gegevens zijn bewaard.")).toBeVisible();
  await userEvent.type(screen.getByRole("textbox", { name: "Naam" }), "x");
  expect(screen.queryByText("Je gegevens zijn bewaard.")).toBeNull();
});

test("an error that arrives while the delete dialog is open shows inside it", async () => {
  const props = {
    me: meFixture,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    saving: false,
    deleting: false,
  };
  const { rerender } = render(<ProfileForm {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Verwijder account" }));
  rerender(<ProfileForm {...props} error="Het lukt nu niet." />);
  expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(
    "Het lukt nu niet.",
  );
});
