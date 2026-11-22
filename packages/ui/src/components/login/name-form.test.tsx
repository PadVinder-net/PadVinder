import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { NameForm } from "./name-form";

test("an empty phone becomes null", async () => {
  const onSubmit = vi.fn();
  render(<NameForm onSubmit={onSubmit} pending={false} />);
  await userEvent.type(screen.getByLabelText("Naam"), " Noor ");
  await userEvent.click(screen.getByRole("button", { name: "Ga verder" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "Noor", phone: null });
});
test("a phone number is passed on", async () => {
  const onSubmit = vi.fn();
  render(<NameForm onSubmit={onSubmit} pending={false} />);
  await userEvent.type(screen.getByLabelText("Naam"), "Noor");
  await userEvent.type(screen.getByLabelText("Telefoonnummer (optioneel)"), "0612345678");
  await userEvent.click(screen.getByRole("button", { name: "Ga verder" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "Noor", phone: "0612345678" });
});
test("an empty name shows the message", async () => {
  const onSubmit = vi.fn();
  render(<NameForm onSubmit={onSubmit} pending={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Ga verder" }));
  expect(screen.getByText("Vul je naam in.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});
test("shows the heading and the privacy text", () => {
  render(<NameForm onSubmit={vi.fn()} pending={false} />);
  expect(screen.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
  expect(
    screen.getByText(
      "Je naam is te zien voor de mensen in je werkgroep. Je telefoonnummer alleen voor de coördinator van de werkgroep.",
    ),
  ).toBeVisible();
});
test("the button is disabled while pending", () => {
  render(<NameForm onSubmit={vi.fn()} pending />);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});
test("a server error is linked to the phone field", () => {
  render(<NameForm onSubmit={vi.fn()} pending={false} error="Het lukt nu niet." />);
  expect(screen.getByLabelText("Telefoonnummer (optioneel)")).toHaveAccessibleDescription(
    "Het lukt nu niet.",
  );
});
test("the fields cut off input at the limits the server accepts", async () => {
  render(<NameForm onSubmit={vi.fn()} pending={false} />);
  const name = screen.getByLabelText("Naam");
  const phone = screen.getByLabelText("Telefoonnummer (optioneel)");
  expect(name).toHaveAttribute("maxlength", "100");
  expect(phone).toHaveAttribute("maxlength", "30");
  await userEvent.type(phone, "1".repeat(40));
  expect(phone).toHaveValue("1".repeat(30));
});
