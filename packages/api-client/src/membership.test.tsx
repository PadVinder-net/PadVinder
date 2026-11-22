import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  applicantMeFixture,
  meFixture,
  pendingRequestFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { client } from "./generated/client.gen";
import {
  apiErrorCode,
  getMeQueryKey,
  listMembersQueryKey,
  listMembershipRequestsQueryKey,
  listWorkingGroupsQueryKey,
  memberListWorkingGroups,
  reviewableWorkingGroups,
  useApproveMembershipRequest,
  useCreateMembershipRequest,
  useDeleteAccount,
  useRejectMembershipRequest,
  useRemoveMembership,
  useWithdrawMembershipRequest,
  type MeResponse,
} from "./index";

function group(name: string) {
  const found = workingGroupsFixture.find((workingGroup) => workingGroup.name === name);
  if (!found) throw new Error(`No fixture group ${name}`);
  return found;
}
const dorp = group("Dorp");
const noord = group("Noord");
const salamanderbrug = group("Salamanderbrug");
const zuidOost = group("Zuid-Oost");

describe("which working groups a user reviews and sees the members of", () => {
  test("an organization admin reviews every group of the organization, a coordinator only their own", () => {
    const admin: MeResponse = {
      ...applicantMeFixture,
      organizationAdminOf: [noord.organization],
    };
    expect(reviewableWorkingGroups(admin, workingGroupsFixture)).toEqual([
      noord,
      salamanderbrug,
      zuidOost,
    ]);
    expect(memberListWorkingGroups(admin, workingGroupsFixture)).toEqual([
      noord,
      salamanderbrug,
      zuidOost,
    ]);

    const coordinator: MeResponse = {
      ...meFixture,
      memberships: [
        { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: noord },
        { id: "0192f3c0-0000-7000-8000-0000000000c2", isCoordinator: false, workingGroup: dorp },
      ],
    };
    expect(reviewableWorkingGroups(coordinator, workingGroupsFixture)).toEqual([noord]);
    expect(memberListWorkingGroups(coordinator, workingGroupsFixture)).toEqual([dorp, noord]);
  });

  test("a coordinator who also administers the organization gets each group once", () => {
    const both: MeResponse = {
      ...meFixture,
      memberships: [
        { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: zuidOost },
      ],
      organizationAdminOf: [zuidOost.organization],
    };
    expect(reviewableWorkingGroups(both, workingGroupsFixture)).toEqual([
      noord,
      salamanderbrug,
      zuidOost,
    ]);
    expect(memberListWorkingGroups(both, workingGroupsFixture)).toEqual([
      noord,
      salamanderbrug,
      zuidOost,
    ]);
  });

  test("a volunteer reviews nothing and sees the members of their own group", () => {
    expect(reviewableWorkingGroups(meFixture, workingGroupsFixture)).toEqual([]);
    expect(memberListWorkingGroups(meFixture, workingGroupsFixture)).toEqual([noord]);
    expect(memberListWorkingGroups(applicantMeFixture, workingGroupsFixture)).toEqual([]);
  });
});

type Answer = Response | Error;

/** Answers the generated client's requests in order and records them. */
function answerWith(...answers: Answer[]) {
  const requests: Request[] = [];
  client.setConfig({
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
      if (answer instanceof Error) throw answer;
      return answer.clone();
    },
  });
  return requests;
}

const apiError = (status: number, code: string) =>
  Response.json({ statusCode: status, error: "Error", message: "x", code }, { status });
const networkFailure = () => new TypeError("Failed to fetch");
const noContent = () => new Response(null, { status: 204 });

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  vi.useRealTimers();
});

function setup<T>(hook: () => T) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(getMeQueryKey(), meFixture);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(hook, { wrapper }) };
}

const isInvalidated = (queryClient: QueryClient, queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated;

const variables = {
  id: "0192f3c0-0000-7000-8000-0000000000d9",
  workingGroupId: noord.id,
  requestedAt: "2027-01-10T19:00:00.000+01:00",
};

describe("useCreateMembershipRequest", () => {
  test("a retry after a network failure sends the same id", async () => {
    vi.useFakeTimers();
    const requests = answerWith(
      networkFailure(),
      Response.json(pendingRequestFixture, { status: 201 }),
    );
    const { result, queryClient } = setup(() => useCreateMembershipRequest());
    const done = result.current.mutateAsync(variables);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toEqual(pendingRequestFixture);
    expect(requests).toHaveLength(2);
    const bodies = await Promise.all(requests.map((request) => request.json()));
    expect(bodies).toEqual([variables, variables]);
    expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
  });

  test("gives up after three retries", async () => {
    vi.useFakeTimers();
    const requests = answerWith(networkFailure());
    const { result } = setup(() => useCreateMembershipRequest());
    const done = result.current.mutateAsync(variables).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiErrorCode(await done)).toBeNull();
    expect(requests).toHaveLength(4);
  });

  test.each(["already_requested", "already_member"])(
    "%s counts as done: me is refetched",
    async (code) => {
      const requests = answerWith(apiError(409, code));
      const { result, queryClient } = setup(() => useCreateMembershipRequest());
      expect(await result.current.mutateAsync(variables)).toBeNull();
      expect(requests).toHaveLength(1);
      expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
    },
  );

  test("too_many_requests surfaces as an error with its code, without a retry", async () => {
    const requests = answerWith(apiError(429, "too_many_requests"));
    const { result, queryClient } = setup(() => useCreateMembershipRequest());
    const error = await result.current.mutateAsync(variables).catch((e: unknown) => e);
    expect(apiErrorCode(error)).toBe("too_many_requests");
    expect(requests).toHaveLength(1);
    expect(isInvalidated(queryClient, getMeQueryKey())).toBe(false);
  });
});

const requestId = requestsForReviewFixture[0]!.id;
const requestListKey = listMembershipRequestsQueryKey({ path: { workingGroupId: noord.id } });
const memberListKey = listMembersQueryKey({ path: { workingGroupId: noord.id } });

function seedLists(queryClient: QueryClient) {
  queryClient.setQueryData(requestListKey, { membershipRequests: requestsForReviewFixture });
  queryClient.setQueryData(memberListKey, { members: [] });
  queryClient.setQueryData(listWorkingGroupsQueryKey(), { workingGroups: workingGroupsFixture });
}

test("withdrawing refetches me", async () => {
  const requests = answerWith(Response.json({ ...pendingRequestFixture, status: "withdrawn" }));
  const { result, queryClient } = setup(() => useWithdrawMembershipRequest());
  await result.current.mutateAsync({ id: pendingRequestFixture.id });
  expect(new URL(requests[0]!.url).pathname).toBe(
    `/api/membership-requests/${pendingRequestFixture.id}/withdraw`,
  );
  expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
});

test("approving refetches the request lists and the member lists", async () => {
  const requests = answerWith(
    Response.json({ ...requestsForReviewFixture[0], status: "approved" }),
  );
  const { result, queryClient } = setup(() => useApproveMembershipRequest());
  seedLists(queryClient);
  await result.current.mutateAsync({ id: requestId });
  expect(new URL(requests[0]!.url).pathname).toBe(`/api/membership-requests/${requestId}/approve`);
  expect(isInvalidated(queryClient, requestListKey)).toBe(true);
  expect(isInvalidated(queryClient, memberListKey)).toBe(true);
  expect(isInvalidated(queryClient, listWorkingGroupsQueryKey())).toBe(false);
});

test("a request someone else decided meanwhile refetches the lists and keeps its code", async () => {
  answerWith(apiError(409, "already_decided"));
  const { result, queryClient } = setup(() => useRejectMembershipRequest());
  seedLists(queryClient);
  const error = await result.current.mutateAsync({ id: requestId }).catch((e: unknown) => e);
  expect(apiErrorCode(error)).toBe("already_decided");
  expect(isInvalidated(queryClient, requestListKey)).toBe(true);
});

test("rejecting refetches the request lists", async () => {
  const requests = answerWith(
    Response.json({ ...requestsForReviewFixture[0], status: "rejected" }),
  );
  const { result, queryClient } = setup(() => useRejectMembershipRequest());
  seedLists(queryClient);
  await result.current.mutateAsync({ id: requestId });
  expect(new URL(requests[0]!.url).pathname).toBe(`/api/membership-requests/${requestId}/reject`);
  expect(isInvalidated(queryClient, requestListKey)).toBe(true);
});

test("removing a member refetches the member lists", async () => {
  const membershipId = "0192f3c0-0000-7000-8000-0000000000e2";
  const requests = answerWith(noContent());
  const { result, queryClient } = setup(() => useRemoveMembership());
  seedLists(queryClient);
  await result.current.mutateAsync({ membershipId });
  expect(requests[0]!.method).toBe("DELETE");
  expect(new URL(requests[0]!.url).pathname).toBe(`/api/memberships/${membershipId}`);
  expect(isInvalidated(queryClient, memberListKey)).toBe(true);
  expect(isInvalidated(queryClient, requestListKey)).toBe(false);
});

describe("useDeleteAccount", () => {
  test("deleting the account clears the cache", async () => {
    const requests = answerWith(noContent());
    const { result, queryClient } = setup(() => useDeleteAccount());
    seedLists(queryClient);
    await result.current.mutateAsync();
    expect(requests[0]!.method).toBe("DELETE");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/me");
    // The gate watches me, so that query stays, as logged out.
    expect(queryClient.getQueryData(getMeQueryKey())).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  test("the last platform admin keeps everything and gets the code", async () => {
    answerWith(apiError(409, "last_platform_admin"));
    const { result, queryClient } = setup(() => useDeleteAccount());
    seedLists(queryClient);
    const error = await result.current.mutateAsync().catch((e: unknown) => e);
    expect(apiErrorCode(error)).toBe("last_platform_admin");
    expect(queryClient.getQueryData(getMeQueryKey())).toEqual(meFixture);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(4);
  });
});
