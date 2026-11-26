import { applicantMeFixture, workingGroupsFixture } from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { listMembershipRequestsQueryKey } from "@padvinder/api-client";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useMemberLists, useRequestLists } from "./working-group-lists";

const noord = workingGroupsFixture.find((g) => g.name === "Noord")!;
const siblings = workingGroupsFixture.filter(
  (g) => g.organization.id === noord.organization.id && g.id !== noord.id,
);
const admin: MeResponse = {
  ...applicantMeFixture,
  memberships: [
    { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: noord },
  ],
  organizationAdminOf: [noord.organization],
  adminConfirmedUntil: null,
};
const directory = { workingGroups: workingGroupsFixture };

function setup() {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

test("useRequestLists asks no list for a hidden group and returns it in hiddenGroups", async () => {
  const { calls } = mockFetch({
    "/api/working-groups": directory,
    [`/api/working-groups/${noord.id}/membership-requests`]: { membershipRequests: [] },
  });
  const { wrapper } = setup();
  const { result } = renderHook(() => useRequestLists(admin), { wrapper });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.groups.map((g) => g.workingGroup.id)).toEqual([noord.id]);
  expect(result.current.hiddenGroups.map((g) => g.id)).toEqual(siblings.map((g) => g.id));
  expect(siblings.length).toBeGreaterThan(0);
  for (const group of siblings) {
    expect(calls).not.toContain(`/api/working-groups/${group.id}/membership-requests`);
  }
});

test("useMemberLists asks no list for a hidden group; a confirmed admin loads all", async () => {
  const members = { members: [] };
  const routes: Record<string, unknown> = { "/api/working-groups": directory };
  for (const g of [noord, ...siblings]) routes[`/api/working-groups/${g.id}/members`] = members;
  const { calls } = mockFetch(routes);
  const { wrapper } = setup();
  const { result } = renderHook(() => useMemberLists(admin), { wrapper });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.hiddenGroups).toHaveLength(siblings.length);
  expect(calls.filter((c) => c.endsWith("/members"))).toEqual([
    `/api/working-groups/${noord.id}/members`,
  ]);

  const confirmed = {
    ...admin,
    adminConfirmedUntil: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const second = setup();
  const { result: all } = renderHook(() => useMemberLists(confirmed), { wrapper: second.wrapper });
  await waitFor(() => expect(all.current.isPending).toBe(false));
  expect(all.current.hiddenGroups).toEqual([]);
  expect(all.current.groups).toHaveLength(siblings.length + 1);
});

test("only background lists carry the background meta", async () => {
  mockFetch({
    "/api/working-groups": directory,
    [`/api/working-groups/${noord.id}/membership-requests`]: { membershipRequests: [] },
  });
  const { client, wrapper } = setup();
  const key = listMembershipRequestsQueryKey({ path: { workingGroupId: noord.id } });
  const { result } = renderHook(() => useRequestLists(admin), { wrapper });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(client.getQueryCache().find({ queryKey: key })?.meta).toBeUndefined();
});
