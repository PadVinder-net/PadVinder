import type { AuditLogEntry } from "@padvinder/contracts";
import { auditLogFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { formatDateTime } from "../../lib/format";
import { AuditLogTable } from "./audit-log-table";

const headings = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent);
const rows = () => screen.getAllByRole("row").slice(1);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent);

test("the table shows when, who and what, and the organization only when asked", () => {
  const { unmount } = render(<AuditLogTable entries={auditLogFixture} showOrganization={false} />);
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat"]);
  expect(rows()).toHaveLength(auditLogFixture.length);
  // Newest first, as given.
  const newest = auditLogFixture[0]!;
  expect(cells(rows()[0]!)).toEqual([
    formatDateTime(newest.occurredAt),
    "Beheerder Voorbeeld",
    "safety_test.published",
  ]);
  const oldest = auditLogFixture.at(-1)!;
  expect(cells(rows().at(-1)!)).toEqual([
    formatDateTime(oldest.occurredAt),
    "Systeem",
    "Organisatie toegevoegd: Paddentrek Voorbeeldstad",
  ]);
  unmount();

  render(<AuditLogTable entries={auditLogFixture} showOrganization />);
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat", "Organisatie"]);
  expect(cells(rows().at(-1)!)[3]).toBe("Paddentrek Voorbeeldstad");
  // An entry without an organization has an empty cell.
  const accountRow = rows()[auditLogFixture.findIndex((e) => e.action === "account.deleted")]!;
  expect(cells(accountRow)).toEqual([
    formatDateTime(auditLogFixture.find((e) => e.action === "account.deleted")!.occurredAt),
    "Verwijderd account",
    "Account verwijderd",
    "",
  ]);
});

test("without entries it says so", () => {
  render(<AuditLogTable entries={[]} showOrganization />);
  expect(screen.getByText("Geen regels gevonden.")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});

test("markup in a name is shown as text", () => {
  const entry: AuditLogEntry = {
    ...auditLogFixture.find((e) => e.action === "membership_request.approved")!,
    actor: { kind: "named", name: "<b>Coördinator</b>", hasLoggedIn: true },
    person: { kind: "named", name: "<img src=x>", hasLoggedIn: true },
    workingGroup: { id: "0192f3c0-0000-7000-8000-0000000000b1", name: "<i>Noord</i>" },
    organization: { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "<u>Paddentrek</u>" },
  };
  render(<AuditLogTable entries={[entry]} showOrganization />);
  expect(screen.getByText("<b>Coördinator</b>")).toBeVisible();
  expect(screen.getByText("Aanmelding goedgekeurd: <img src=x> bij <i>Noord</i>")).toBeVisible();
  expect(screen.getByText("<u>Paddentrek</u>")).toBeVisible();
  expect(document.querySelector("b, img, i, u")).toBeNull();
});
