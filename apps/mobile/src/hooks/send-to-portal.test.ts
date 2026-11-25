import { expect, test } from "vitest";
import { portalAddressFor, portalUrlForThisBrowser } from "./send-to-portal";

const id = "0192f3c0-0000-7000-8000-0000000000d1";

test.each([
  [`/app/more/membership-requests/${id}`, false, `/membership-requests?request=${id}`],
  ["/app/more/membership-requests", false, "/membership-requests"],
  ["/app/more/membership-requests/not-an-id", false, "/membership-requests"],
  [`/app/more/membership-requests/${id}`, true, null],
  ["/app/more/members", false, null],
  ["/app/", false, null],
])("portalAddressFor(%j, phone %j) is %j", (pathname, phone, expected) => {
  expect(portalAddressFor({ pathname }, phone)).toBe(expected);
});

test("portalUrlForThisBrowser stays in the app in jsdom (no request link, no dev port)", () => {
  expect(portalUrlForThisBrowser()).toBeNull();
});
