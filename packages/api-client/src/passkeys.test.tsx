import { QueryClientProvider } from "@tanstack/react-query";
import {
  organizationDetailFixture,
  passkeysFixture,
  platformAdminMeFixture,
  platformAdminsFixture,
} from "@padvinder/contracts/fixtures";
import type { PasskeyResult } from "@padvinder/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOrganization } from "./administration";
import { client } from "./generated/client.gen";
import { useMe } from "./me-query";
import { createPasskey } from "./passkey-client";
import { usePasskeyConfirmation } from "./passkey-confirmation";
import {
  useCreatePasskey,
  usePasskeys,
  useRemovePasskey,
  useResetOrganizationAdminPasskeys,
  useResetPlatformAdminPasskeys,
} from "./passkeys";
import { usePlatformAdmins } from "./platform-administration";
import { createQueryClient } from "./query-client";

vi.mock("./passkey-client", () => ({
  authenticateWithPasskey: vi.fn(),
  createPasskey: vi.fn(),
  passkeysSupported: vi.fn(() => true),
}));

type Seen = { call: string };

/** Answers by "METHOD /path" and counts each call. */
function mockFetch(routes: Record<string, unknown>) {
  const seen: Seen[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const call = `${request.method} ${new URL(request.url).pathname}`;
      seen.push({ call });
      const answer = routes[call];
      if (answer === undefined) throw new TypeError(`No mock for ${call}`);
      return answer instanceof Response ? answer.clone() : Response.json(answer);
    },
  });
  return { count: (call: string) => seen.filter((s) => s.call === call).length };
}

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  vi.clearAllMocks();
});

function setup<T>(hook: () => T) {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

const error = (status: number, code: string) =>
  Response.json({ statusCode: status, error: "x", message: "x", code }, { status });

const organizationId = organizationDetailFixture.id;
const adminId = organizationDetailFixture.admins[1]!.userId;
const passkeyId = passkeysFixture.passkeys[0]!.id;
const platformAdminId = platformAdminsFixture[0]!.userId;

test("useCreatePasskey asks for a confirmation on confirmation_required and shows no error", async () => {
  mockFetch({ "GET /api/me": platformAdminMeFixture, "GET /api/passkeys": passkeysFixture });
  vi.mocked(createPasskey).mockResolvedValue({ ok: false, error: "confirmation_required" });
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    create: useCreatePasskey(),
  }));
  await waitFor(() => expect(result.current.confirmation.hasPasskey).toBe(false));

  await act(async () => result.current.create.create());

  expect(result.current.confirmation.open).toBe(true);
  expect(result.current.create).toMatchObject({ pending: false, error: null });
});

test("useCreatePasskey shows another failure, and on success refetches me and the list", async () => {
  const m = mockFetch({
    "GET /api/me": platformAdminMeFixture,
    "GET /api/passkeys": passkeysFixture,
  });
  vi.mocked(createPasskey).mockResolvedValueOnce({ ok: false, error: "already_registered" });
  const { result } = setup(() => ({
    me: useMe(),
    passkeys: usePasskeys(),
    create: useCreatePasskey(),
    confirmation: usePasskeyConfirmation(),
  }));
  await waitFor(() =>
    expect(result.current.passkeys.isSuccess && result.current.me.isSuccess).toBe(true),
  );

  await act(async () => result.current.create.create());
  expect(result.current.create.error).toBe("already_registered");
  expect(result.current.confirmation.open).toBe(false);

  let finish: (result: PasskeyResult) => void = () => {};
  vi.mocked(createPasskey).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  act(() => {
    result.current.create.create();
    // A second tap while the first runs does nothing.
    result.current.create.create();
  });
  expect(result.current.create).toMatchObject({ pending: true, error: null });
  expect(createPasskey).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ok: true }));

  expect(result.current.create).toMatchObject({ pending: false, error: null });
  await waitFor(() => expect(m.count("GET /api/passkeys")).toBe(2));
  await waitFor(() => expect(m.count("GET /api/me")).toBe(2));
});

test("removing and resetting refetch the lists and me, also after an error", async () => {
  const m = mockFetch({
    "GET /api/me": platformAdminMeFixture,
    "GET /api/passkeys": passkeysFixture,
    "GET /api/platform-admins": { platformAdmins: platformAdminsFixture },
    [`GET /api/organizations/${organizationId}`]: organizationDetailFixture,
    [`DELETE /api/passkeys/${passkeyId}`]: new Response(null, { status: 204 }),
    [`DELETE /api/organizations/${organizationId}/admins/${adminId}/passkeys`]: error(
      403,
      "not_allowed",
    ),
    [`DELETE /api/platform-admins/${platformAdminId}/passkeys`]: new Response(null, {
      status: 204,
    }),
  });
  const { result } = setup(() => ({
    me: useMe(),
    passkeys: usePasskeys(),
    platformAdmins: usePlatformAdmins(),
    organization: useOrganization(organizationId),
    remove: useRemovePasskey(),
    resetOrganizationAdmin: useResetOrganizationAdminPasskeys(),
    resetPlatformAdmin: useResetPlatformAdminPasskeys(),
  }));
  await waitFor(() =>
    expect(
      result.current.me.isSuccess &&
        result.current.passkeys.isSuccess &&
        result.current.platformAdmins.isSuccess &&
        result.current.organization.isSuccess,
    ).toBe(true),
  );
  const lists = [
    "GET /api/me",
    "GET /api/passkeys",
    "GET /api/platform-admins",
    `GET /api/organizations/${organizationId}`,
  ];
  const expectFetched = (times: number) =>
    waitFor(() => expect(lists.map((call) => m.count(call))).toEqual(lists.map(() => times)));

  await act(async () => result.current.remove.mutateAsync(passkeyId));
  await expectFetched(2);

  await act(async () =>
    expect(
      result.current.resetOrganizationAdmin.mutateAsync({ organizationId, userId: adminId }),
    ).rejects.toMatchObject({ code: "not_allowed" }),
  );
  await expectFetched(3);

  await act(async () => result.current.resetPlatformAdmin.mutateAsync(platformAdminId));
  await expectFetched(4);
});
