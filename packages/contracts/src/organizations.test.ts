import { expect, test } from "vitest";
import { organizationDetailFixture, organizationsFixture } from "./fixtures";
import {
  addOrganizationAdminRequestSchema,
  createOrganizationRequestSchema,
  organizationDetailSchema,
  organizationListResponseSchema,
  organizationNameSchema,
  updateOrganizationRequestSchema,
} from "./organizations";

test("a name is trimmed", () =>
  expect(organizationNameSchema.parse("  Paddentrek ")).toBe("Paddentrek"));

test.each(["", "   ", "x".repeat(101), "a@b"])("a name %j is refused", (name) =>
  expect(organizationNameSchema.safeParse(name).success).toBe(false),
);

test("the fixtures match their schemas", () => {
  expect(organizationListResponseSchema.parse({ organizations: organizationsFixture })).toEqual({
    organizations: organizationsFixture,
  });
  expect(organizationDetailSchema.parse(organizationDetailFixture)).toEqual(
    organizationDetailFixture,
  );
});

test("create normalizes the addresses and allows a missing or empty contact address", () => {
  expect(
    createOrganizationRequestSchema.parse({ name: "X", adminEmail: " Jan@Example.test " }),
  ).toEqual({ name: "X", adminEmail: "jan@example.test" });
  expect(
    createOrganizationRequestSchema.parse({
      name: "X",
      adminEmail: "a@example.test",
      contactEmail: null,
    }),
  ).toMatchObject({ contactEmail: null });
});

test.each([
  { name: "X", adminEmail: "jan@" },
  { name: " ", adminEmail: "jan@example.test" },
  { name: "X" },
  { name: "X", adminEmail: "jan@example.test", extra: 1 },
  { name: "X", adminEmail: "deleted-1@deleted.invalid" },
])("create rejects %j", (body) =>
  expect(createOrganizationRequestSchema.safeParse(body).success).toBe(false),
);

test("update takes a partial body, null for the contact address, and needs a key", () => {
  expect(updateOrganizationRequestSchema.parse({ contactEmail: null })).toEqual({
    contactEmail: null,
  });
  expect(updateOrganizationRequestSchema.parse({ name: " Y " })).toEqual({ name: "Y" });
  expect(updateOrganizationRequestSchema.safeParse({}).success).toBe(false);
  expect(updateOrganizationRequestSchema.safeParse({ color: "red" }).success).toBe(false);
  expect(updateOrganizationRequestSchema.safeParse({ name: null }).success).toBe(false);
});

test("adding an admin takes exactly an address", () => {
  expect(addOrganizationAdminRequestSchema.parse({ email: "A@Example.test" })).toEqual({
    email: "a@example.test",
  });
  expect(
    addOrganizationAdminRequestSchema.safeParse({ email: "a@example.test", x: 1 }).success,
  ).toBe(false);
});
