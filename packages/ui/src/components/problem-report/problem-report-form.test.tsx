import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ProblemReportForm, type ProblemReportInput } from "./problem-report-form";

const name = "Anne de Vries";
const email = "anne@example.test";
const intro =
  "Werkt er iets niet? Schrijf op wat je deed en wat er misging. Dit gaat naar de makers van PadVinder. Wil je een antwoord? Stuur dan je naam en e-mailadres mee.";
const checkboxLabel = "Stuur mijn naam en e-mailadres mee, zodat we je kunnen mailen";

const message = () => screen.getByRole("textbox", { name: "Wat ging er mis?" });
const contact = () => screen.getByRole("checkbox", { name: checkboxLabel });

test("shows the text of the spec; the checkbox starts unchecked with the name and address", () => {
  render(<ProblemReportForm name={name} email={email} onSubmit={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Meld een probleem" })).toBeVisible();
  expect(screen.getByText(intro)).toBeVisible();
  expect(message()).toHaveValue("");
  expect(contact()).not.toBeChecked();
  expect(screen.getByText(name)).toBeVisible();
  expect(screen.getByText(email)).toBeVisible();
});

test("the heading can be left out, for a modal that has its own title", () => {
  render(<ProblemReportForm name={name} email={email} onSubmit={vi.fn()} heading={false} />);
  expect(screen.queryByRole("heading")).toBeNull();
});

test("Verstuur is disabled while the message is empty or only spaces", async () => {
  render(<ProblemReportForm name={name} email={email} onSubmit={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Verstuur" })).toBeDisabled();
  await userEvent.type(message(), "   ");
  expect(screen.getByRole("button", { name: "Verstuur" })).toBeDisabled();
  await userEvent.type(message(), "De kaart blijft leeg");
  expect(screen.getByRole("button", { name: "Verstuur" })).toBeEnabled();
});

test("sends the trimmed message, with the checkbox as ticked", async () => {
  const onSubmit = vi.fn<(input: ProblemReportInput) => Promise<void>>().mockResolvedValue();
  render(<ProblemReportForm name={name} email={email} onSubmit={onSubmit} />);
  await userEvent.type(message(), "  De kaart blijft leeg  ");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(onSubmit).toHaveBeenLastCalledWith({
    message: "De kaart blijft leeg",
    includeContact: false,
  });
  // Ticking the box by its label, a large target.
  await userEvent.click(screen.getByText(checkboxLabel));
  expect(contact()).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(onSubmit).toHaveBeenLastCalledWith({
    message: "De kaart blijft leeg",
    includeContact: true,
  });
});

test("the button is disabled while sending, so a report is not sent twice", async () => {
  let finish = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<ProblemReportForm name={name} email={email} onSubmit={onSubmit} />);
  await userEvent.type(message(), "Het tellen lukt niet");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  const sending = screen.getByRole("button", { name: "Even geduld…" });
  expect(sending).toBeDisabled();
  await userEvent.click(sending);
  expect(onSubmit).toHaveBeenCalledOnce();
  finish();
  expect(await screen.findByRole("button", { name: "Verstuur" })).toBeEnabled();
});

test("a failed send keeps the message and shows the error", async () => {
  function Harness() {
    const [error, setError] = useState<string>();
    return (
      <ProblemReportForm
        name={name}
        email={email}
        errorText={error}
        onSubmit={async () => {
          setError("Je melding is niet verstuurd. Probeer het zo nog eens.");
          throw new Error("502");
        }}
      />
    );
  }
  render(<Harness />);
  await userEvent.type(message(), "Het tellen lukt niet");
  await userEvent.click(contact());
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Je melding is niet verstuurd. Probeer het zo nog eens.",
  );
  expect(message()).toHaveValue("Het tellen lukt niet");
  // The error belongs to the field, for a screen reader too.
  expect(message()).toHaveAttribute("aria-invalid", "true");
  expect(message()).toHaveAccessibleDescription(
    "Je melding is niet verstuurd. Probeer het zo nog eens.",
  );
  expect(contact()).toBeChecked();
  expect(screen.getByRole("button", { name: "Verstuur" })).toBeEnabled();
});

test("without an error the field is not marked invalid", () => {
  render(<ProblemReportForm name={name} email={email} onSubmit={vi.fn()} />);
  expect(message()).not.toHaveAttribute("aria-invalid");
  expect(message()).not.toHaveAttribute("aria-describedby");
});

test("a message is at most 2,000 characters, as the API takes", () => {
  render(<ProblemReportForm name={name} email={email} onSubmit={vi.fn()} />);
  expect(message()).toHaveAttribute("maxLength", "2000");
});

test("without a name the address shows alone", () => {
  render(<ProblemReportForm name="" email={email} onSubmit={vi.fn()} />);
  expect(screen.getByText(email)).toBeVisible();
});
