import { expect, test } from "vitest";
import { isPhoneScreen } from "./is-phone";

test.each([
  [{ width: 412, height: 915 }, true],
  [{ width: 915, height: 412 }, true],
  [{ width: 768, height: 1024 }, false],
  [{ width: 1280, height: 800 }, false],
])("isPhoneScreen(%j) is %j", (screen, expected) => {
  expect(isPhoneScreen(screen)).toBe(expected);
});
