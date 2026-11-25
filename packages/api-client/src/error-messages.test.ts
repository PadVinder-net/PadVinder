import { expect, test } from "vitest";
import { accountDeletionBlockers, apiErrorCode, apiErrorIssues } from "./index";

const body = (code: string) => ({ statusCode: 409, error: "Conflict", message: "x", code });

test("apiErrorCode reads the code of an API error body", () => {
  expect(apiErrorCode(body("already_decided"))).toBe("already_decided");
});

test("apiErrorCode is null for a network failure or anything that is not an API error", () => {
  expect(apiErrorCode(new TypeError("Failed to fetch"))).toBeNull();
  expect(apiErrorCode(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBeNull();
  // A proxy's HTML page during a deploy, or an empty body.
  expect(apiErrorCode("<html>502 Bad Gateway</html>")).toBeNull();
  expect(apiErrorCode({})).toBeNull();
  expect(apiErrorCode(null)).toBeNull();
  expect(apiErrorCode(undefined)).toBeNull();
});

test("apiErrorIssues reads the issues of an API error body", () => {
  const issues = [{ path: "dutchName", message: "x" }];
  expect(apiErrorIssues({ ...body("name_taken"), issues })).toEqual(issues);
});

test("apiErrorIssues is empty without issues, for a network failure and for anything else", () => {
  expect(apiErrorIssues(body("name_taken"))).toEqual([]);
  expect(apiErrorIssues(new TypeError("Failed to fetch"))).toEqual([]);
  expect(apiErrorIssues(null)).toEqual([]);
});

test("accountDeletionBlockers reads the blockers of a blocked deletion", () => {
  const blockers = [
    {
      role: "coordinator",
      workingGroupName: "Noord",
      organizationName: "Paddentrek Voorbeeldstad",
      contactEmail: "contact-voorbeeldstad@example.test",
    },
    {
      role: "organizationAdmin",
      workingGroupName: null,
      organizationName: "Paddenwerkgroep Fictiefdorp",
      contactEmail: null,
    },
  ];
  expect(accountDeletionBlockers({ ...body("last_coordinator"), blockers })).toEqual(blockers);
});

test("accountDeletionBlockers is empty without blockers, for a network failure and for anything else", () => {
  expect(accountDeletionBlockers(body("last_platform_admin"))).toEqual([]);
  expect(accountDeletionBlockers(new TypeError("Failed to fetch"))).toEqual([]);
  expect(accountDeletionBlockers(null)).toEqual([]);
  // A blocker of an unknown shape is not shown half.
  expect(
    accountDeletionBlockers({ ...body("last_coordinator"), blockers: [{ role: "volunteer" }] }),
  ).toEqual([]);
});
