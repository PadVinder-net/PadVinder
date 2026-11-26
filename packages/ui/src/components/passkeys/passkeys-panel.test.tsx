import { passkeysFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PasskeysPanel, type PasskeysPanelProps } from "./passkeys-panel";

function props(extra: Partial<PasskeysPanelProps> = {}): PasskeysPanelProps {
  return {
    passkeys: passkeysFixture.passkeys,
    loading: false,
    loadFailed: false,
    onRetry: vi.fn(),
    creating: false,
    createError: null,
    onCreate: vi.fn(),
    removing: false,
    onRemove: vi.fn(),
    phoneHint: false,
    ...extra,
  };
}

test("the panel lists the date added, and Synchroniseert met je andere apparaten only for a synced passkey", () => {
  render(<PasskeysPanel {...props()} />);
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Toegevoegd op 20 november 2026");
  expect(rows[0]).toHaveTextContent("Synchroniseert met je andere apparaten");
  expect(rows[1]).toHaveTextContent("Toegevoegd op 24 november 2026");
  expect(rows[1]).not.toHaveTextContent("Synchroniseert");
});

test("removing one of several asks with the usual text and removes that passkey", async () => {
  const p = props();
  render(<PasskeysPanel {...p} />);
  await userEvent.click(
    within(screen.getAllByRole("listitem")[1]!).getByRole("button", { name: "Verwijder" }),
  );
  const dialog = screen.getByRole("alertdialog", { name: "Toegangssleutel verwijderen?" });
  expect(dialog).toHaveTextContent("Je kunt hem daarna niet meer gebruiken.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(p.onRemove).toHaveBeenCalledExactlyOnceWith(passkeysFixture.passkeys[1]);
});

test("removing the only passkey asks with the text for the last one", async () => {
  render(<PasskeysPanel {...props({ passkeys: [passkeysFixture.passkeys[0]!] })} />);
  await userEvent.click(screen.getByRole("button", { name: "Verwijder" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Dit is je laatste toegangssleutel. Daarna maak je een nieuwe de volgende keer dat je iets beheert.",
  );
});

test("the dialog closes when removing ends without an error, and stays with one", async () => {
  const { rerender } = render(<PasskeysPanel {...props()} />);
  await userEvent.click(screen.getAllByRole("button", { name: "Verwijder" })[0]!);
  rerender(<PasskeysPanel {...props({ removing: true })} />);
  rerender(<PasskeysPanel {...props({ removing: false, removeError: "Dit mag je niet doen." })} />);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Dit mag je niet doen.");
  rerender(<PasskeysPanel {...props({ removing: true })} />);
  rerender(<PasskeysPanel {...props({ removing: false })} />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("the phone hint shows only with phoneHint", () => {
  const hint = "Wil je ook op je telefoon beheren? Kies dan in het venster voor je telefoon.";
  const { rerender } = render(<PasskeysPanel {...props()} />);
  expect(screen.queryByText(hint)).toBeNull();
  rerender(<PasskeysPanel {...props({ phoneHint: true })} />);
  expect(screen.getByText(hint)).toBeVisible();
});

test("adding calls onCreate, shows Even geduld… while creating, and shows the create error", async () => {
  const p = props({ passkeys: [] });
  const { rerender } = render(<PasskeysPanel {...p} />);
  expect(screen.getByText("Je hebt nog geen toegangssleutel.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Voeg een toegangssleutel toe" }));
  expect(p.onCreate).toHaveBeenCalledOnce();
  rerender(<PasskeysPanel {...props({ passkeys: [], creating: true })} />);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  rerender(<PasskeysPanel {...props({ passkeys: [], createError: "cancelled" })} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Dat lukte niet. Probeer het nog eens.");
});

test("loading and a failed load", async () => {
  const { rerender } = render(<PasskeysPanel {...props({ passkeys: undefined, loading: true })} />);
  expect(screen.getByText("Toegangssleutels laden…")).toBeVisible();
  const p = props({ passkeys: undefined, loadFailed: true });
  rerender(<PasskeysPanel {...p} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Het lukt nu niet.");
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(p.onRetry).toHaveBeenCalledOnce();
});
