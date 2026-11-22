import { meFixture, meWithoutNameFixture } from "@padvinder/contracts/fixtures";
import { expect, test } from "vitest";
import { gateState } from "./index";

test("gateState", () => {
  expect(gateState(null)).toBe("login");
  expect(gateState(meWithoutNameFixture)).toBe("name");
  expect(gateState(meFixture)).toBe("app");
});
