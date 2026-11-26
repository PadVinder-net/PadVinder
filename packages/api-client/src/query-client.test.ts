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

test("when the me query finds the session gone, the data of that user is dropped", async () => {
  const client = clientWithMe();
  client.setQueryData(["other"], "data of the previous user");
  client.getMutationCache().build(client, { mutationFn: async () => "x" });
  await client.fetchQuery({ queryKey: getMeQueryKey(), queryFn: async () => null, staleTime: 0 });
  expect(client.getQueryData(["other"])).toBeUndefined();
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(client.getQueryData(getMeQueryKey())).toBeNull();
});

test("a me query that finds a user keeps the other data", async () => {
  const client = clientWithMe();
  client.setQueryData(["other"], "data");
  await client.fetchQuery({
    queryKey: getMeQueryKey(),
    queryFn: async () => meFixture,
    staleTime: 0,
  });
  expect(client.getQueryData(["other"])).toBe("data");
});

test("other errors are still retried three times; passkey_required is not retried", async () => {
  const client = createQueryClient();
  const failing = (error: unknown) => vi.fn(() => Promise.reject(error));
  const internal = failing({ code: "internal_error" });
  await client
    .fetchQuery({ queryKey: ["internal"], queryFn: internal, retryDelay: 0 })
    .catch(() => {});
  expect(internal).toHaveBeenCalledTimes(4);
  const required = failing({ statusCode: 403, error: "x", message: "x", code: "passkey_required" });
  await client
    .fetchQuery({ queryKey: ["required"], queryFn: required, retryDelay: 0 })
    .catch(() => {});
  expect(required).toHaveBeenCalledOnce();
});
