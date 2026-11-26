import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  applicantMeFixture,
  meFixture,
  pendingRequestFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { client } from "./generated/client.gen";
import {
  apiErrorCode,
  deleteAccountMutationKey,
  getMeQueryKey,
  listMembersQueryKey,
  listMembershipRequestsQueryKey,
  listWorkingGroupsQueryKey,
  mayOpenMembers,
  mayRemoveMember,
  memberListWorkingGroups,
  otherWorkingGroups,
  relationToWorkingGroup,
  reviewableWorkingGroups,
  isAdminConfirmed,
  splitByConfirmation,
  useApproveMembershipRequest,
  useCreateMembershipRequest,
  useDeleteAccount,
  useReviewableMembershipRequests,
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

describe("what a user may do with the members of a working group", () => {
  const coordinatorOfNoord: MeResponse = {
    ...meFixture,
    memberships: [
      { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: noord },
      { id: "0192f3c0-0000-7000-8000-0000000000c2", isCoordinator: false, workingGroup: dorp },
    ],
  };
  const adminOfVoorbeeldstad: MeResponse = {
    ...applicantMeFixture,
    organizationAdminOf: [noord.organization],
  };
  const platformAdmin: MeResponse = {
    ...applicantMeFixture,
    user: { ...applicantMeFixture.user, isPlatformAdmin: true },
  };

  test("the relation is the strongest one, as on the server", () => {
    expect(relationToWorkingGroup(platformAdmin, dorp)).toBe("platformAdmin");
    expect(relationToWorkingGroup(adminOfVoorbeeldstad, zuidOost)).toBe("organizationAdmin");
    expect(relationToWorkingGroup(adminOfVoorbeeldstad, dorp)).toBe("outsider");
    expect(relationToWorkingGroup(coordinatorOfNoord, noord)).toBe("coordinator");
    expect(relationToWorkingGroup(coordinatorOfNoord, dorp)).toBe("volunteer");
    expect(relationToWorkingGroup(coordinatorOfNoord, zuidOost)).toBe("outsider");
  });

  test("a coordinator removes volunteers of their group; admins remove anyone", () => {
    expect(mayRemoveMember(coordinatorOfNoord, noord, false)).toBe(true);
    expect(mayRemoveMember(coordinatorOfNoord, noord, true)).toBe(false);
    expect(mayRemoveMember(coordinatorOfNoord, dorp, false)).toBe(false);
    expect(mayRemoveMember(coordinatorOfNoord, zuidOost, false)).toBe(false);
    expect(mayRemoveMember(adminOfVoorbeeldstad, noord, true)).toBe(true);
    expect(mayRemoveMember(adminOfVoorbeeldstad, dorp, false)).toBe(false);
    expect(mayRemoveMember(platformAdmin, dorp, true)).toBe(true);
    expect(mayRemoveMember(meFixture, noord, false)).toBe(false);
  });

  test("only coordinators and admins open a member", () => {
    expect(mayOpenMembers(coordinatorOfNoord, noord)).toBe(true);
    expect(mayOpenMembers(coordinatorOfNoord, dorp)).toBe(false);
    expect(mayOpenMembers(adminOfVoorbeeldstad, salamanderbrug)).toBe(true);
    expect(mayOpenMembers(platformAdmin, dorp)).toBe(true);
    expect(mayOpenMembers(meFixture, noord)).toBe(false);
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

test("the reviewer's list returns the open requests", async () => {
  const requests = answerWith(Response.json({ membershipRequests: requestsForReviewFixture }));
  const { result } = setup(() => useReviewableMembershipRequests());
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data?.membershipRequests).toEqual(requestsForReviewFixture);
  expect(new URL(requests[0]!.url).pathname).toBe("/api/membership-requests");
});

describe("useDeleteAccount", () => {
  test("deleting the account clears the cache", async () => {
    const requests = answerWith(noContent());
    const { result, queryClient } = setup(() => useDeleteAccount());
    seedLists(queryClient);
    // An earlier profile change of the same user, whose variables hold a name and a phone.
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationKey: ["updateMe"],
        mutationFn: async () => null,
      })
      .execute({ name: "Noor", phone: "06 12345678" });
    await result.current.mutateAsync();
    expect(requests[0]!.method).toBe("DELETE");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/me");
    // The gate watches me, so that query stays, as logged out.
    expect(queryClient.getQueryData(getMeQueryKey())).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    // Only the deletion stays, for the gate's notice.
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.options.mutationKey),
    ).toEqual([deleteAccountMutationKey]);
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

describe("otherWorkingGroups", () => {
  test("leaves out the user's groups and the group they asked for", () => {
    const waiting = { ...applicantMeFixture, membershipRequest: pendingRequestFixture };
    const others = otherWorkingGroups(waiting, workingGroupsFixture);
    expect(others).not.toContainEqual(pendingRequestFixture.workingGroup);
    expect(others).toEqual(
      workingGroupsFixture.filter((g) => g.id !== pendingRequestFixture.workingGroup.id),
    );
    const member = otherWorkingGroups(meFixture, workingGroupsFixture);
    expect(member).not.toContainEqual(noord);
    expect(member).toHaveLength(workingGroupsFixture.length - 1);
  });

  test("keeps the group of a rejected request", () => {
    const rejected = {
      ...applicantMeFixture,
      membershipRequest: { ...pendingRequestFixture, status: "rejected" as const },
    };
    expect(otherWorkingGroups(rejected, workingGroupsFixture)).toEqual(workingGroupsFixture);
  });
});

describe("the confirmation of admin power", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const later = "2026-11-26T13:00:00Z";
  const coordinatorAdmin: MeResponse = {
    ...meFixture,
    memberships: [
      { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: noord },
    ],
    organizationAdminOf: [noord.organization],
    adminConfirmedUntil: null,
  };
  const volunteerAdmin: MeResponse = {
    ...coordinatorAdmin,
    memberships: [
      { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: false, workingGroup: noord },
    ],
  };
  const all = reviewableWorkingGroups(coordinatorAdmin, workingGroupsFixture);

  test("splitByConfirmation: an unconfirmed organization admin who coordinates Noord loads Noord and hides the rest", () => {
    const { loaded, hidden } = splitByConfirmation(coordinatorAdmin, all, now);
    expect(loaded).toEqual([noord]);
    expect(hidden).toEqual(all.filter((g) => g.id !== noord.id));
    expect(hidden.length).toBeGreaterThan(0);
  });

  test("a confirmed admin loads all; a coordinator without an admin role has nothing hidden", () => {
    const confirmed = { ...coordinatorAdmin, adminConfirmedUntil: later };
    expect(splitByConfirmation(confirmed, all, now)).toEqual({ loaded: all, hidden: [] });
    const plain = { ...coordinatorAdmin, organizationAdminOf: [] };
    const own = reviewableWorkingGroups(plain, workingGroupsFixture);
    expect(splitByConfirmation(plain, own, now)).toEqual({ loaded: own, hidden: [] });
  });

  test("at adminConfirmedUntil exactly the admin's groups are hidden", () => {
    const edge = { ...coordinatorAdmin, adminConfirmedUntil: now.toISOString() };
    expect(isAdminConfirmed(edge, now)).toBe(false);
    expect(splitByConfirmation(edge, all, now).hidden.length).toBe(all.length - 1);
  });

  test("for request lists a volunteer-admin's own group is hidden too: they do not coordinate it", () => {
    const groups = reviewableWorkingGroups(volunteerAdmin, workingGroupsFixture);
    expect(splitByConfirmation(volunteerAdmin, groups, now).loaded).toEqual([noord]);
    expect(splitByConfirmation(volunteerAdmin, groups, now, "coordination").loaded).toEqual([]);
  });

  test("mayOpenMembers with now: a volunteer-admin unconfirmed cannot open, confirmed can; without now as before", () => {
    expect(mayOpenMembers(volunteerAdmin, noord, { now })).toBe(false);
    expect(mayOpenMembers({ ...volunteerAdmin, adminConfirmedUntil: later }, noord, { now })).toBe(
      true,
    );
    expect(mayOpenMembers(volunteerAdmin, noord)).toBe(true);
    expect(relationToWorkingGroup(volunteerAdmin, noord, { now })).toBe("volunteer");
    expect(mayRemoveMember(coordinatorAdmin, noord, true, { now })).toBe(false);
    expect(mayRemoveMember(coordinatorAdmin, noord, true)).toBe(true);
  });
});
