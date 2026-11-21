import { expect, test } from "vitest";
import { formatDateTime } from "./format";

test("shows Amsterdam time (CET in March)", () =>
  expect(formatDateTime("2027-03-01T19:30:00.000Z")).toContain("20:30"));
test("shows Amsterdam time (CEST in April)", () =>
  expect(formatDateTime("2027-04-01T19:30:00.000Z")).toContain("21:30"));
