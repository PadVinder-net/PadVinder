import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { CrashFlow } from "./crash-flow";
import type { ProblemReportInput } from "./problem-report-form";

const contact = { name: "Anne de Vries", email: "anne@example.test" };

test("Vertel wat er gebeurde opens the form in place, and a sent report thanks the user", async () => {
  const onSend = vi.fn<(input: ProblemReportInput) => Promise<void>>().mockResolvedValue();
  const onReload = vi.fn();
  render(<CrashFlow variant="app" contact={contact} onReload={onReload} onSend={onSend} />);
  await userEvent.click(screen.getByRole("button", { name: "Vertel wat er gebeurde" }));
  // The button that had focus is gone: focus moves to the form's heading.
  expect(screen.getByRole("heading", { name: "Meld een probleem" })).toHaveFocus();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Wat ging er mis?" }),
    "Ik tikte op Leden",
  );
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(onSend).toHaveBeenCalledWith({ message: "Ik tikte op Leden", includeContact: false });
  expect(await screen.findByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  expect(screen.getByRole("status")).toHaveFocus();
  expect(screen.queryByRole("textbox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Laad opnieuw" }));
  expect(onReload).toHaveBeenCalledOnce();
});

test("Laad opnieuw stays below the form", async () => {
  const onReload = vi.fn();
  render(<CrashFlow variant="portal" contact={contact} onReload={onReload} onSend={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.click(screen.getByRole("button", { name: "Laad opnieuw" }));
  expect(onReload).toHaveBeenCalledOnce();
});

test("a failed report keeps the form and its text, with the error", async () => {
  function Harness() {
    const [error, setError] = useState<string>();
    return (
      <CrashFlow
        variant="app"
        contact={contact}
        onReload={vi.fn()}
        errorText={error}
        onSend={async () => {
          setError("Je melding is niet verstuurd. Probeer het zo nog eens.");
          throw new Error("502");
        }}
      />
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Vast");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Je melding is niet verstuurd.");
  expect(screen.getByRole("textbox", { name: "Wat ging er mis?" })).toHaveValue("Vast");
  expect(screen.queryByText("Bedankt, je melding is verstuurd.")).toBeNull();
});

test("before login there is no report button", () => {
  render(<CrashFlow variant="app" contact={null} onReload={vi.fn()} onSend={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Vertel wat er gebeurde" })).toBeNull();
});

test("a flow that starts at a step (a story) takes no focus", () => {
  render(
    <CrashFlow
      variant="app"
      contact={contact}
      onReload={vi.fn()}
      onSend={vi.fn()}
      initialStep="form"
    />,
  );
  expect(document.body).toHaveFocus();
});
