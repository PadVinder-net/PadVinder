import {
  applicantMeFixture,
  meFixture,
  meWithoutNameFixture,
  platformAdminMeFixture,
  rejectedMeFixture,
  waitingMeFixture,
} from "@padvinder/contracts/fixtures";
import { expect, test } from "vitest";
import { gateState, meLoadFailed } from "./index";

test("gateState", () => {
  expect(gateState(null)).toBe("login");
  expect(gateState(meWithoutNameFixture)).toBe("name");
  expect(gateState(applicantMeFixture)).toBe("choose");
  expect(gateState(rejectedMeFixture)).toBe("choose");
  expect(gateState(waitingMeFixture)).toBe("waiting");
  expect(gateState(meFixture)).toBe("app");
  expect(gateState(platformAdminMeFixture)).toBe("app"); // no membership, still the app
});

test("an organization admin without a membership sees the app", () => {
  expect(
    gateState({
      ...applicantMeFixture,
      organizationAdminOf: [{ id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Org" }],
    }),
  ).toBe("app");
});

test("a member with a pending request elsewhere sees the app, not the waiting screen", () => {
  expect(gateState({ ...meFixture, membershipRequest: waitingMeFixture.membershipRequest })).toBe(
    "app",
  );
});

test("a name is asked before anything else", () => {
  expect(gateState({ ...waitingMeFixture, user: { ...waitingMeFixture.user, name: "" } })).toBe(
    "name",
  );
});

test("meLoadFailed only when there is no known state", () => {
  expect(meLoadFailed({ isError: true, data: undefined })).toBe(true);
  expect(meLoadFailed({ isError: true, data: meFixture })).toBe(false);
  expect(meLoadFailed({ isError: true, data: null })).toBe(false);
  expect(meLoadFailed({ isError: false, data: undefined })).toBe(false);
});
