import { meFixture, meWithoutNameFixture } from "@padvinder/contracts/fixtures";
import { expect, test } from "vitest";
import { gateState, meLoadFailed } from "./index";

test("gateState", () => {
  expect(gateState(null)).toBe("login");
  expect(gateState(meWithoutNameFixture)).toBe("name");
  expect(gateState(meFixture)).toBe("app");
});

test("meLoadFailed only when there is no known state", () => {
  expect(meLoadFailed({ isError: true, data: undefined })).toBe(true);
  expect(meLoadFailed({ isError: true, data: meFixture })).toBe(false);
  expect(meLoadFailed({ isError: true, data: null })).toBe(false);
  expect(meLoadFailed({ isError: false, data: undefined })).toBe(false);
});
