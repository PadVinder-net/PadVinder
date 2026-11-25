import { QueryClientProvider } from "@tanstack/react-query";
import { speciesFixture } from "@padvinder/contracts/fixtures";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { client } from "./generated/client.gen";
import {
  apiErrorCode,
  apiErrorIssues,
  useCreateSpecies,
  useSpecies,
  useUpdateSpecies,
} from "./index";
import { createTestQueryClient } from "./testing";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

/** Answers by "METHOD /path"; the generated client gets this `fetch` through its config. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      calls.push(`${request.method} ${path}`);
      const answer = routes[`${request.method} ${path}`];
      if (answer === undefined) throw new TypeError(`No mock for ${request.method} ${path}`);
      return answer instanceof Response ? answer.clone() : Response.json(answer);
    },
  });
  return { calls };
}

function setup<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

const newSpecies = {
  dutchName: "vroedmeesterpad",
  scientificName: "Alytes obstetricans",
  needsVerification: false,
};

test("useSpecies loads the list", async () => {
  mockFetch({ "GET /api/species": { species: speciesFixture } });
  const { result } = setup(() => useSpecies());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.species).toEqual(speciesFixture);
});

test("creating refetches the list", async () => {
  const created = { ...newSpecies, id: "0192f3c0-0000-7000-8000-0000000000aa", active: true };
  const { calls } = mockFetch({
    "GET /api/species": { species: speciesFixture },
    "POST /api/species": Response.json(created, { status: 201 }),
  });
  const { result } = setup(() => ({ list: useSpecies(), create: useCreateSpecies() }));
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  const answer = await result.current.create.mutateAsync(newSpecies);
  expect(answer).toEqual(created);
  await waitFor(() => expect(calls.filter((call) => call === "GET /api/species")).toHaveLength(2));
});

test("updating sends the patch to the species and refetches the list", async () => {
  const first = speciesFixture[0]!;
  const updated = { ...first, active: false };
  const { calls } = mockFetch({
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${first.id}`]: updated,
  });
  const { result } = setup(() => ({ list: useSpecies(), update: useUpdateSpecies() }));
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  const answer = await result.current.update.mutateAsync({
    speciesId: first.id,
    patch: { active: false },
  });
  expect(answer).toEqual(updated);
  await waitFor(() => expect(calls.filter((call) => call === "GET /api/species")).toHaveLength(2));
});

test("a 409 surfaces with its code and the field", async () => {
  mockFetch({
    "POST /api/species": Response.json(
      {
        statusCode: 409,
        error: "Conflict",
        message: "x",
        code: "name_taken",
        issues: [{ path: "scientificName", message: "x" }],
      },
      { status: 409 },
    ),
  });
  const { result } = setup(() => useCreateSpecies());
  const error = await result.current.mutateAsync(newSpecies).catch((caught: unknown) => caught);
  expect(apiErrorCode(error)).toBe("name_taken");
  expect(apiErrorIssues(error)).toEqual([{ path: "scientificName", message: "x" }]);
});
