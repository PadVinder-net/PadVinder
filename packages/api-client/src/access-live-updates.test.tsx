import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { meFixture, requestsForReviewFixture } from "@padvinder/contracts/fixtures";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAccessLiveUpdates } from "./access-live-updates";
import {
  getMeQueryKey,
  getMembershipRequestQueryKey,
  getOrganizationQueryKey,
  listManagedWorkingGroupsQueryKey,
  listOrganizationsQueryKey,
  listMembershipRequestsQueryKey,
} from "./generated/@tanstack/react-query.gen";
import { FakeEventSource } from "./testing";

const latestSource = () => FakeEventSource.instances.at(-1)!;
const emit = (type: string, data: unknown) => latestSource().emit(type, JSON.stringify(data));

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const northId = requestsForReviewFixture[0]!.workingGroup.id;
const organizationId = requestsForReviewFixture[0]!.workingGroup.organization.id;
const southEastId = requestsForReviewFixture[2]!.workingGroup.id;
const northListKey = listMembershipRequestsQueryKey({ path: { workingGroupId: northId } });
const southEastListKey = listMembershipRequestsQueryKey({ path: { workingGroupId: southEastId } });
const managedKey = listManagedWorkingGroupsQueryKey();
const organizationsKey = listOrganizationsQueryKey();
const organizationKey = getOrganizationQueryKey({ path: { organizationId } });
const requestKey = getMembershipRequestQueryKey({ path: { id: requestsForReviewFixture[0]!.id } });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(getMeQueryKey(), meFixture);
  queryClient.setQueryData(northListKey, { membershipRequests: [] });
  queryClient.setQueryData(southEastListKey, { membershipRequests: [] });
  queryClient.setQueryData(requestKey, requestsForReviewFixture[0]);
  queryClient.setQueryData(managedKey, { workingGroups: [] });
  queryClient.setQueryData(organizationsKey, { organizations: [] });
  queryClient.setQueryData(organizationKey, null);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useAccessLiveUpdates(), { wrapper }) };
}

const isInvalidated = (queryClient: QueryClient, queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated;

test("access-changed refetches me", () => {
  const { queryClient } = setup();
  emit("access-changed", { type: "access-changed", userId: meFixture.user.id });
  expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
});

test("membership-requests-changed refetches the requests of that working group", () => {
  const { queryClient } = setup();
  emit("membership-requests-changed", {
    type: "membership-requests-changed",
    workingGroupId: northId,
    organizationId,
  });
  expect(isInvalidated(queryClient, northListKey)).toBe(true);
  expect(isInvalidated(queryClient, requestKey)).toBe(true);
  expect(isInvalidated(queryClient, southEastListKey)).toBe(false);
  expect(isInvalidated(queryClient, getMeQueryKey())).toBe(false);
});

test("a reopened stream refetches me and the request lists", () => {
  const { queryClient } = setup();
  latestSource().onopen?.();
  expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
  expect(isInvalidated(queryClient, northListKey)).toBe(true);
  expect(isInvalidated(queryClient, southEastListKey)).toBe(true);
  expect(isInvalidated(queryClient, requestKey)).toBe(true);
});

test("access-changed refetches the administration lists", () => {
  const { queryClient } = setup();
  emit("access-changed", { type: "access-changed", userId: meFixture.user.id });
  expect(isInvalidated(queryClient, managedKey)).toBe(true);
  expect(isInvalidated(queryClient, organizationsKey)).toBe(true);
  expect(isInvalidated(queryClient, organizationKey)).toBe(true);
});

test("membership-requests-changed and a reopened stream refetch the administration lists", () => {
  const { queryClient } = setup();
  emit("membership-requests-changed", {
    type: "membership-requests-changed",
    workingGroupId: northId,
    organizationId,
  });
  expect(isInvalidated(queryClient, managedKey)).toBe(true);
  queryClient.setQueryData(managedKey, { workingGroups: [] });
  expect(isInvalidated(queryClient, managedKey)).toBe(false);
  latestSource().onopen?.();
  expect(isInvalidated(queryClient, managedKey)).toBe(true);
  expect(isInvalidated(queryClient, organizationsKey)).toBe(true);
});

test("a stream the server refuses refetches me, and is opened again later", () => {
  vi.useFakeTimers();
  try {
    const { queryClient } = setup();
    latestSource().fail(true);
    expect(isInvalidated(queryClient, getMeQueryKey())).toBe(true);
    expect(isInvalidated(queryClient, northListKey)).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test("unmounting closes the stream", () => {
  const { unmount } = setup();
  unmount();
  expect(latestSource().closed).toBe(true);
});
