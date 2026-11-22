import { meFixture } from "@padvinder/contracts/fixtures";
import { expect, test, vi } from "vitest";
import { getMeQueryKey } from "./index";
import { createQueryClient } from "./query-client";

const notLoggedIn = { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" };

function clientWithMe() {
  const client = createQueryClient();
  client.setQueryData(getMeQueryKey(), meFixture);
  return client;
}

test("a 401 from a query invalidates the me query", async () => {
  const client = clientWithMe();
  await client
    .fetchQuery({ queryKey: ["other"], queryFn: () => Promise.reject(notLoggedIn), retry: false })
    .catch(() => {});
  expect(client.getQueryState(getMeQueryKey())?.isInvalidated).toBe(true);
});

test("a 401 from a mutation invalidates the me query", async () => {
  const client = clientWithMe();
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(notLoggedIn) })
    .execute(undefined)
    .catch(() => {});
  expect(client.getQueryState(getMeQueryKey())?.isInvalidated).toBe(true);
});

test("other errors leave the me query alone", async () => {
  const client = clientWithMe();
  await client
    .fetchQuery({
      queryKey: ["other"],
      queryFn: () => Promise.reject({ code: "internal_error" }),
      retry: false,
    })
    .catch(() => {});
  expect(client.getQueryState(getMeQueryKey())?.isInvalidated).toBe(false);
});

test("a failing me query itself does not invalidate itself in a loop", async () => {
  const client = createQueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  await client
    .fetchQuery({
      queryKey: getMeQueryKey(),
      queryFn: () => Promise.reject(notLoggedIn),
      retry: false,
    })
    .catch(() => {});
  expect(spy).not.toHaveBeenCalled();
});
