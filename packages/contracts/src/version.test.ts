import { expect, test } from "vitest";
import { compareCalVer } from "./version";

test("compares numerically, not as text", () =>
  expect(compareCalVer("2027.10.0", "2027.9.0")).toBe(1));
test("older year is lower", () => expect(compareCalVer("2026.5.3", "2027.0.0")).toBe(-1));
test("equal", () => expect(compareCalVer("2027.1.0", "2027.1.0")).toBe(0));
test("rejects non-CalVer input", () => expect(() => compareCalVer("1.2", "2027.0.0")).toThrow());
