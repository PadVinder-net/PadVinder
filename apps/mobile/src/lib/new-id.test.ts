import { expect, test } from "vitest";
import { newId } from "./new-id";

test("newId gives a different UUIDv7 each time", () => {
  const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(newId()).toMatch(uuidV7);
  expect(newId()).not.toBe(newId());
});
