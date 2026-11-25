import { expect, test } from "vitest";
import { appAddressFor, appUrlForThisBrowser } from "./send-to-app";

const id = "0192f3c0-0000-7000-8000-0000000000d1";

test.each([
  ["/membership-requests", `?request=${id}`, true, `/app/more/membership-requests/${id}`],
  ["/membership-requests", "", true, "/app/more/membership-requests"],
  [
    "/membership-requests",
    `?request=${id.toUpperCase()}`,
    true,
    `/app/more/membership-requests/${id}`,
  ],
  ["/membership-requests/", `?request=${id}`, true, `/app/more/membership-requests/${id}`],
  ["/membership-requests", "?request=../../x", true, "/app/more/membership-requests"],
  ["/membership-requests", `?request=${id}`, false, null],
  ["/working-groups", "", true, null],
])("appAddressFor(%j, %j, phone %j) is %j", (pathname, search, phone, expected) => {
  expect(appAddressFor({ pathname, search }, phone)).toBe(expected);
});

test("appUrlForThisBrowser stays in the portal in jsdom", () => {
  expect(appUrlForThisBrowser()).toBeNull();
});
