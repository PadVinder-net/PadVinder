import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EmailForm } from "./email-form";

test("an address without @ shows the message and does not submit", async () => {
  const onSubmit = vi.fn();
  render(<EmailForm onSubmit={onSubmit} pending={false} />);
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  expect(screen.getByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});
test("trims the address", async () => {
  const onSubmit = vi.fn();
  render(<EmailForm onSubmit={onSubmit} pending={false} />);
  await userEvent.type(screen.getByLabelText("E-mailadres"), " noor@example.test ");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("noor@example.test");
});
test("the input asks the phone for an email keyboard", () => {
  render(<EmailForm onSubmit={vi.fn()} pending={false} />);
  const input = screen.getByLabelText("E-mailadres");
  expect(input).toHaveAttribute("type", "email");
  expect(input).toHaveAttribute("autocomplete", "email");
  expect(input).toHaveAttribute("inputmode", "email");
});
test("shows the heading, the text and a server error", () => {
  render(<EmailForm onSubmit={vi.fn()} pending={false} error="Het lukt nu niet." />);
  expect(screen.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(screen.getByText("Vul je e-mailadres in. Je krijgt een code per mail.")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Het lukt nu niet.");
});
test("the button is disabled while pending", () => {
  render(<EmailForm onSubmit={vi.fn()} pending />);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
});
test("while the code is asked for, the passkey button is disabled and keeps its label", () => {
  render(<EmailForm onSubmit={vi.fn()} pending onPasskey={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: "Even geduld…" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toHaveAttribute("type", "submit");
  expect(screen.getByRole("button", { name: "Log in met je toegangssleutel" })).toBeDisabled();
});
test("while the passkey login pends, Stuur code is disabled and keeps its label", () => {
  render(<EmailForm onSubmit={vi.fn()} pending passkeyPending onPasskey={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: "Even geduld…" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toHaveAttribute("type", "button");
  expect(screen.getByRole("button", { name: "Stuur code" })).toBeDisabled();
});

test("EmailForm shows the notice", () => {
  render(<EmailForm onSubmit={() => {}} pending={false} notice="Je account is verwijderd." />);
  expect(screen.getByText("Je account is verwijderd.")).toBeVisible();
});
