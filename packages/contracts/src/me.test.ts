import { expect, test } from "vitest";
import { meResponseSchema, updateMeRequestSchema } from "./me";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  meFixture,
  meWithoutNameFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
} from "./fixtures";

test("accepts one key", () =>
  expect(updateMeRequestSchema.parse({ name: " Noor " })).toEqual({ name: "Noor" }));

test("null and empty text both clear the phone", () => {
  expect(updateMeRequestSchema.parse({ phone: null })).toEqual({ phone: null });
  expect(updateMeRequestSchema.parse({ phone: "  " })).toEqual({ phone: null });
});

test("trims the phone", () =>
  expect(updateMeRequestSchema.parse({ phone: " 06 1234 " })).toEqual({ phone: "06 1234" }));

test.each([
  [{}],
  [{ nam: "x" }],
  [{ name: "x", extra: 1 }],
  [{ name: "" }],
  [{ name: "   " }],
  [{ name: "x".repeat(101) }],
  [{ phone: "0".repeat(31) }],
  [{ name: null }],
])("rejects %j", (body) => expect(updateMeRequestSchema.safeParse(body).success).toBe(false));

test("the fixtures match the response schema", () => {
  expect(meResponseSchema.parse(meFixture)).toEqual(meFixture);
  expect(meFixture.user).toMatchObject({
    name: "Noor de Vries",
    email: "noor@example.test",
    phone: null,
  });
  expect(meResponseSchema.parse(meWithoutNameFixture).user.name).toBe("");
});

test.each([
  meFixture,
  meWithoutNameFixture,
  coordinatorMeFixture,
  platformAdminMeFixture,
  applicantMeFixture,
  twoOrganizationsMeFixture,
])("every me fixture parses", (fixture) =>
  expect(meResponseSchema.parse(fixture)).toEqual(fixture),
);
