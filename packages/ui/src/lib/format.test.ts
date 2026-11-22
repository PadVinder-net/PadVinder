import { expect, test } from "vitest";
import { formatDate, formatDateTime } from "./format";

test("shows Amsterdam time (CET in March)", () =>
  expect(formatDateTime("2027-03-01T19:30:00.000Z")).toContain("20:30"));
test("shows Amsterdam time (CEST in April)", () =>
  expect(formatDateTime("2027-04-01T19:30:00.000Z")).toContain("21:30"));

test("formatDate shows the Amsterdam day", () =>
  expect(formatDate("2027-01-10T23:30:00.000Z")).toBe("11 januari 2027"));
