import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import { AuditLogFilters, type AuditLogFilterValue } from "./audit-log-filters";

beforeAll(() => {
  // jsdom lacks what Radix's select uses to open and scroll its list.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const one = [{ id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" }];
const two = [
  ...one,
  { id: "0192f3c0-0000-7000-8000-0000000000a2", name: "Paddenwerkgroep Fictiefdorp" },
];

function setup(
  organizations: { id: string; name: string }[],
  value: AuditLogFilterValue = { organizationId: null, actionGroup: null },
) {
  const onChange = vi.fn();
  render(
    <AuditLogFilters
      organizations={organizations}
      actionGroups={["organization", "workingGroup", "role", "membership"]}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

test("the filters show the organization select only with more than one organization, and call onChange with null for the first option", async () => {
  const onChangeOne = setup(one);
  expect(screen.queryByRole("combobox", { name: "Organisatie" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Actie" })).toHaveTextContent("Alle acties");
  await userEvent.click(screen.getByRole("combobox", { name: "Actie" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Alle acties",
    "Organisaties",
    "Werkgroepen",
    "Rollen",
    "Leden en aanmeldingen",
  ]);
  await userEvent.click(screen.getByRole("option", { name: "Rollen" }));
  expect(onChangeOne).toHaveBeenLastCalledWith({ organizationId: null, actionGroup: "role" });
  document.body.innerHTML = "";

  const onChange = setup(two, { organizationId: two[1]!.id, actionGroup: "role" });
  const organization = screen.getByRole("combobox", { name: "Organisatie" });
  expect(organization).toHaveTextContent("Paddenwerkgroep Fictiefdorp");
  expect(screen.getByRole("combobox", { name: "Actie" })).toHaveTextContent("Rollen");
  await userEvent.click(organization);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Alle organisaties",
    "Paddentrek Voorbeeldstad",
    "Paddenwerkgroep Fictiefdorp",
  ]);
  await userEvent.click(screen.getByRole("option", { name: "Alle organisaties" }));
  expect(onChange).toHaveBeenLastCalledWith({ organizationId: null, actionGroup: "role" });

  await userEvent.click(screen.getByRole("combobox", { name: "Actie" }));
  await userEvent.click(screen.getByRole("option", { name: "Alle acties" }));
  expect(onChange).toHaveBeenLastCalledWith({ organizationId: two[1]!.id, actionGroup: null });

  await userEvent.click(organization);
  await userEvent.click(screen.getByRole("option", { name: "Paddentrek Voorbeeldstad" }));
  expect(onChange).toHaveBeenLastCalledWith({ organizationId: two[0]!.id, actionGroup: "role" });
});
