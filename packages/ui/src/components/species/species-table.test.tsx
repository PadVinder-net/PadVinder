import { speciesFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SpeciesTable } from "./species-table";

const noop = () => {};

function rowOf(name: string) {
  return screen.getByText(name).closest("tr")!;
}

test("shows the Dutch name with a capital and the scientific name in italics", () => {
  render(<SpeciesTable species={speciesFixture} onEdit={noop} onSetActive={noop} />);
  expect(screen.getByText("Gewone pad")).toBeVisible();
  expect(screen.getByText("Bufo bufo").tagName).toBe("EM");
  for (const heading of [
    "Nederlandse naam",
    "Wetenschappelijke naam",
    "Betrouwbaarheidscheck",
    "Actief",
  ]) {
    expect(screen.getByRole("columnheader", { name: heading })).toBeVisible();
  }
});

test("shows ja and nee and keeps the given order", () => {
  render(<SpeciesTable species={speciesFixture} onEdit={noop} onSetActive={noop} />);
  const row = within(rowOf("Kamsalamander")).getAllByRole("cell");
  expect(row[2]).toHaveTextContent("ja");
  expect(row[3]).toHaveTextContent("ja");
  const off = within(rowOf("Vuursalamander")).getAllByRole("cell");
  expect(off[3]).toHaveTextContent("nee");
  const names = screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]!.textContent);
  expect(names).toEqual(
    speciesFixture.map((s) => s.dutchName[0]!.toUpperCase() + s.dutchName.slice(1)),
  );
});

test("Zet uit calls onSetActive(id, false); a species that is off offers Zet aan", async () => {
  const onSetActive = vi.fn();
  const onEdit = vi.fn();
  render(<SpeciesTable species={speciesFixture} onEdit={onEdit} onSetActive={onSetActive} />);
  await userEvent.click(within(rowOf("Gewone pad")).getByRole("button", { name: "Zet uit" }));
  expect(onSetActive).toHaveBeenCalledWith("01a204b4-08c6-7dc0-ae95-8072a93f1667", false);
  const offRow = within(rowOf("Vuursalamander"));
  expect(offRow.queryByRole("button", { name: "Zet uit" })).toBeNull();
  await userEvent.click(offRow.getByRole("button", { name: "Zet aan" }));
  expect(onSetActive).toHaveBeenLastCalledWith(speciesFixture.find((s) => !s.active)!.id, true);
  await userEvent.click(within(rowOf("Gewone pad")).getByRole("button", { name: "Wijzig" }));
  expect(onEdit).toHaveBeenCalledWith("01a204b4-08c6-7dc0-ae95-8072a93f1667");
});

test("a species that is off has muted text in its row", () => {
  render(<SpeciesTable species={speciesFixture} onEdit={noop} onSetActive={noop} />);
  expect(rowOf("Vuursalamander")).toHaveClass("text-muted-foreground");
  expect(rowOf("Gewone pad")).not.toHaveClass("text-muted-foreground");
});

test("markup in a name is shown as text", () => {
  const species = [{ ...speciesFixture[0]!, dutchName: "<i>x</i>" }];
  render(<SpeciesTable species={species} onEdit={noop} onSetActive={noop} />);
  expect(screen.getByText("<i>x</i>")).toBeVisible();
});
