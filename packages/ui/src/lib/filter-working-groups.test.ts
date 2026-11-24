import { workingGroupsFixture } from "@padvinder/contracts/fixtures";
import { expect, test } from "vitest";
import { filterWorkingGroups, foldText } from "./filter-working-groups";

const all = ["Buitengebied", "Dorp", "Noord", "Salamanderbrug", "Zuid-Oost"];

test.each([
  ["salamanderbrûg", ["Salamanderbrug"]],
  ["SALAMANDER", ["Salamanderbrug"]],
  ["zuid oost", ["Zuid-Oost"]],
  ["poelwijk", ["Salamanderbrug"]],
  ["voorbeeldstad", ["Noord", "Salamanderbrug", "Zuid-Oost"]],
  ["fictiefdorp", ["Buitengebied", "Dorp"]],
  ["", all],
  ["  ", all],
  ["xyz", []],
])("filter %j", (query, names) =>
  expect(filterWorkingGroups(workingGroupsFixture, query).map((g) => g.name)).toEqual(names),
);
test("foldText removes accents and punctuation", () =>
  expect(foldText(" Coördinatie  Één-twee ")).toBe("coordinatie een twee"));
