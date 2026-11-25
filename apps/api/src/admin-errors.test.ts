import { AdminError, type AdminErrorCode } from "@padvinder/db";
import { expect, test } from "vitest";
import { adminErrorToApiError } from "./admin-errors";

const answer = (code: AdminErrorCode, email?: string) =>
  adminErrorToApiError(new AdminError(code), email ? { email } : undefined);

test.each(["organization_not_found", "working_group_not_found", "membership_not_found"] as const)(
  "%s is 404 not_found",
  (code) => expect(answer(code)).toMatchObject({ statusCode: 404, code: "not_found" }),
);

test.each(["invalid_email", "user_not_found"] as const)(
  "%s is 400 with an issue on the email field",
  (code) => {
    expect(answer(code)).toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      issues: [{ path: "email" }],
    });
    expect(answer(code, "adminEmail").issues?.[0]?.path).toBe("adminEmail");
  },
);

test("name_taken is 409 with an issue on name", () =>
  expect(answer("name_taken")).toMatchObject({
    statusCode: 409,
    code: "name_taken",
    issues: [{ path: "name" }],
  }));

test("person_outside_organization is 409 with an issue on the email field", () =>
  expect(answer("person_outside_organization", "coordinatorEmail")).toMatchObject({
    statusCode: 409,
    code: "person_outside_organization",
    issues: [{ path: "coordinatorEmail" }],
  }));

test.each([
  ["last_organization_admin", "last_organization_admin"],
  ["last_coordinator", "last_coordinator"],
  ["last_platform_admin", "last_platform_admin"],
  ["no_coordinator", "no_coordinator"],
] as const)("%s is 409 with that code", (code, expected) =>
  expect(answer(code)).toMatchObject({ statusCode: 409, code: expected }),
);

test("working_group_inactive is rethrown", () =>
  expect(() => answer("working_group_inactive")).toThrow(AdminError));
