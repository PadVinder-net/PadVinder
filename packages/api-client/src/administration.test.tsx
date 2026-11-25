import { QueryClientProvider } from "@tanstack/react-query";
import {
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  meFixture,
  organizationDetailFixture,
  organizationsFixture,
} from "@padvinder/contracts/fixtures";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  administersOrganization,
  apiErrorCode,
  apiErrorIssues,
  mayManageWorkingGroup,
  useCreateWorkingGroup,
  useManagedWorkingGroups,
  useMe,
  useOrganization,
  useOrganizations,
  useSetCoordinator,
} from "./index";
import { client } from "./generated/client.gen";
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

const organization = organizationDetailFixture;
const group = managedWorkingGroupsFixture[0]!;
const count = (calls: string[], call: string) => calls.filter((c) => c === call).length;

test("useManagedWorkingGroups and useOrganizations load their lists", async () => {
  mockFetch({
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    "GET /api/organizations": { organizations: organizationsFixture },
  });
  const { result } = setup(() => ({
    groups: useManagedWorkingGroups(),
    organizations: useOrganizations(),
  }));
  await waitFor(() => expect(result.current.groups.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.organizations.isSuccess).toBe(true));
  expect(result.current.groups.data?.workingGroups).toEqual(managedWorkingGroupsFixture);
  expect(result.current.organizations.data?.organizations).toEqual(organizationsFixture);
});

test("useOrganization loads the detail", async () => {
  mockFetch({ [`GET /api/organizations/${organization.id}`]: organization });
  const { result } = setup(() => useOrganization(organization.id));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual(organization);
});

test("useOrganization gives null for a 404", async () => {
  const { calls } = mockFetch({
    [`GET /api/organizations/${organization.id}`]: Response.json(
      { statusCode: 404, error: "Not Found", message: "x", code: "not_found" },
      { status: 404 },
    ),
  });
  const { result } = setup(() => useOrganization(organization.id));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toBeNull();
  expect(count(calls, `GET /api/organizations/${organization.id}`)).toBe(1);
});

test("useOrganization still fails on another error", async () => {
  mockFetch({
    [`GET /api/organizations/${organization.id}`]: Response.json(
      { statusCode: 500, error: "Internal Server Error", message: "x", code: "internal_error" },
      { status: 500 },
    ),
  });
  const { result } = setup(() => useOrganization(organization.id));
  await waitFor(() => expect(result.current.isError).toBe(true));
});

test("creating a working group refetches the lists, the organizations and me", async () => {
  const created = { ...group, id: "0192f3c0-0000-7000-8000-0000000000aa" };
  const { calls } = mockFetch({
    "GET /api/me": meFixture,
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    "GET /api/organizations": { organizations: organizationsFixture },
    [`GET /api/organizations/${organization.id}`]: organization,
    [`POST /api/organizations/${organization.id}/working-groups`]: Response.json(created, {
      status: 201,
    }),
  });
  const { result } = setup(() => ({
    me: useMe(),
    groups: useManagedWorkingGroups(),
    organizations: useOrganizations(),
    detail: useOrganization(organization.id),
    create: useCreateWorkingGroup(),
  }));
  await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.me.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.groups.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.organizations.isSuccess).toBe(true));
  const answer = await result.current.create.mutateAsync({
    organizationId: organization.id,
    body: { name: "Nieuw", city: "Voorbeeldstad", coordinatorEmail: "co@example.test" },
  });
  expect(answer).toEqual(created);
  await waitFor(() => expect(count(calls, "GET /api/managed-working-groups")).toBe(2));
  await waitFor(() => expect(count(calls, "GET /api/organizations")).toBe(2));
  await waitFor(() => expect(count(calls, `GET /api/organizations/${organization.id}`)).toBe(2));
  await waitFor(() => expect(count(calls, "GET /api/me")).toBe(2));
});

test("a 409 surfaces with its code and the field", async () => {
  mockFetch({
    [`POST /api/organizations/${organization.id}/working-groups`]: Response.json(
      {
        statusCode: 409,
        error: "Conflict",
        message: "x",
        code: "person_outside_organization",
        issues: [{ path: "coordinatorEmail", message: "x" }],
      },
      { status: 409 },
    ),
  });
  const { result } = setup(() => useCreateWorkingGroup());
  const error = await result.current
    .mutateAsync({
      organizationId: organization.id,
      body: { name: "Nieuw", city: "Voorbeeldstad", coordinatorEmail: "co@example.test" },
    })
    .catch((caught: unknown) => caught);
  expect(apiErrorCode(error)).toBe("person_outside_organization");
  expect(apiErrorIssues(error)).toEqual([{ path: "coordinatorEmail", message: "x" }]);
});

test("a failed mutation refetches too", async () => {
  const membershipId = "0192f3c0-0000-7000-8000-0000000000d1";
  const { calls } = mockFetch({
    "GET /api/me": meFixture,
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    [`PATCH /api/memberships/${membershipId}`]: Response.json(
      { statusCode: 409, error: "Conflict", message: "x", code: "last_coordinator" },
      { status: 409 },
    ),
  });
  const { result } = setup(() => ({
    me: useMe(),
    groups: useManagedWorkingGroups(),
    set: useSetCoordinator(),
  }));
  await waitFor(() => expect(result.current.groups.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.me.isSuccess).toBe(true));
  const error = await result.current.set
    .mutateAsync({ membershipId, isCoordinator: false })
    .catch((caught: unknown) => caught);
  expect(apiErrorCode(error)).toBe("last_coordinator");
  await waitFor(() => expect(count(calls, "GET /api/managed-working-groups")).toBe(2));
  await waitFor(() => expect(count(calls, "GET /api/me")).toBe(2));
});

test("mayManageWorkingGroup: a platform admin and the organization's admin, not a coordinator", () => {
  const admin = { ...meFixture, organizationAdminOf: [group.organization] };
  const other = {
    ...meFixture,
    organizationAdminOf: [{ id: "0192f3c0-0000-7000-8000-0000000000a2", name: "Anders" }],
  };
  const platform = { ...meFixture, user: { ...meFixture.user, isPlatformAdmin: true } };
  expect(mayManageWorkingGroup(platform, group)).toBe(true);
  expect(mayManageWorkingGroup(admin, group)).toBe(true);
  expect(mayManageWorkingGroup(other, group)).toBe(false);
  expect(mayManageWorkingGroup(coordinatorMeFixture, group)).toBe(false);
  expect(mayManageWorkingGroup(meFixture, group)).toBe(false);
});

test("administersOrganization: a platform admin and an admin of it", () => {
  const admin = { ...meFixture, organizationAdminOf: [group.organization] };
  const platform = { ...meFixture, user: { ...meFixture.user, isPlatformAdmin: true } };
  expect(administersOrganization(platform, group.organization.id)).toBe(true);
  expect(administersOrganization(admin, group.organization.id)).toBe(true);
  expect(administersOrganization(admin, "0192f3c0-0000-7000-8000-0000000000a2")).toBe(false);
  expect(administersOrganization(coordinatorMeFixture, group.organization.id)).toBe(false);
});
