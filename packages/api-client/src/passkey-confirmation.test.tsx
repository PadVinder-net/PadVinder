import {
  focusManager,
  QueryClientProvider,
  useMutation,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import {
  platformAdminMeFixture,
  passkeysFixture,
  requestsForReviewFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse, PasskeyResult } from "@padvinder/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAccessLiveUpdates } from "./access-live-updates";
import { useManagedWorkingGroups } from "./administration";
import { apiErrorCode } from "./error-messages";
import { client } from "./generated/client.gen";
import {
  getMeQueryKey,
  listManagedWorkingGroupsQueryKey,
  listMembersQueryKey,
  listMembershipRequestsQueryKey,
  listPasskeysOptions,
} from "./generated/@tanstack/react-query.gen";
import { authenticateWithPasskey, createPasskey } from "./passkey-client";
import {
  backgroundRequestMeta,
  requestPasskeyConfirmation,
  useAdminConfirmationExpiry,
  usePasskeyConfirmation,
} from "./passkey-confirmation";
import { useMe } from "./me-query";
import { createQueryClient } from "./query-client";
import { subscribeToServerEvents } from "./server-events";
import { FakeEventSource } from "./testing";

vi.mock("./passkey-client", () => ({
  authenticateWithPasskey: vi.fn(),
  createPasskey: vi.fn(),
  passkeysSupported: vi.fn(() => true),
}));

const required = {
  statusCode: 403,
  error: "Forbidden",
  message: "Confirm with a passkey first",
  code: "passkey_required",
};

const withPasskey: MeResponse = {
  ...platformAdminMeFixture,
  user: { ...platformAdminMeFixture.user, hasPasskey: true },
};
const withoutPasskey: MeResponse = platformAdminMeFixture;

/** Whether the server would now accept the requests: set by a successful ceremony. */
let confirmed = false;
let me: MeResponse = withPasskey;
let calls: string[] = [];

const succeed = async (): Promise<PasskeyResult> => {
  confirmed = true;
  return { ok: true };
};

/** One `fetch` for the generated client and for the sign-out call; counts each "METHOD /path". */
async function answer(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const request =
    input instanceof Request
      ? input
      : new Request(new URL(String(input), "http://localhost"), init);
  const call = `${request.method} ${new URL(request.url).pathname}`;
  calls.push(call);
  switch (call) {
    case "GET /api/me":
      return Response.json(me);
    case "GET /api/passkeys":
      return Response.json(passkeysFixture);
    case "POST /api/auth/sign-out":
      return Response.json({ success: true });
    default:
      throw new TypeError(`No mock for ${call}`);
  }
}

const count = (call: string) => calls.filter((c) => c === call).length;

beforeEach(() => {
  confirmed = false;
  me = withPasskey;
  calls = [];
  client.setConfig({ baseUrl: "http://localhost", fetch: answer });
  vi.stubGlobal("fetch", answer);
  vi.mocked(authenticateWithPasskey).mockImplementation(succeed);
  vi.mocked(createPasskey).mockImplementation(succeed);
});

afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setup<T>(hook: () => T, queryClient: QueryClient = createQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(hook, { wrapper }) };
}

/** A query function the server refuses until a confirmation. */
function guarded<T>(value: T) {
  return vi.fn(async () => {
    if (!confirmed) throw required;
    return value;
  });
}

test("a query that fails with passkey_required opens the modal; after confirm it is refetched and succeeds", async () => {
  const queryFn = guarded("de leden");
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    members: useQuery({ queryKey: ["members"], queryFn }),
  }));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  expect(result.current.members.isError).toBe(true);
  expect(result.current.confirmation).toMatchObject({ pending: false, error: null });

  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.members.data).toBe("de leden"));
  expect(result.current.confirmation.open).toBe(false);
  expect(queryFn).toHaveBeenCalledTimes(2);
});

/** How often `open` went from false to true over the renders seen. */
function timesOpened(seen: boolean[]): number {
  return seen.filter((open, i) => open && !(seen[i - 1] ?? false)).length;
}

test("three failing queries open the modal once and are all refetched after one confirmation", async () => {
  const queryFns = [guarded("a"), guarded("b"), guarded("c")];
  const seenOpen: boolean[] = [];
  const { result } = setup(() => {
    const confirmation = usePasskeyConfirmation();
    seenOpen.push(confirmation.open);
    return {
      confirmation,
      queries: [
        useQuery({ queryKey: ["a"], queryFn: queryFns[0]! }),
        useQuery({ queryKey: ["b"], queryFn: queryFns[1]! }),
        useQuery({ queryKey: ["c"], queryFn: queryFns[2]! }),
      ],
    };
  });
  await waitFor(() => expect(result.current.queries.every((q) => q.isError)).toBe(true));
  expect(result.current.confirmation.open).toBe(true);

  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.queries.map((q) => q.data)).toEqual(["a", "b", "c"]));
  expect(timesOpened(seenOpen)).toBe(1);
  expect(authenticateWithPasskey).toHaveBeenCalledOnce();
  for (const queryFn of queryFns) expect(queryFn).toHaveBeenCalledTimes(2);
});

test("a query that fails while the ceremony runs joins the same round", async () => {
  let finish: (result: PasskeyResult) => void = () => {};
  vi.mocked(authenticateWithPasskey).mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const first = guarded("eerste");
  const second = guarded("tweede");
  let showSecond = false;
  const seenOpen: boolean[] = [];
  const { result, rerender } = setup(() => {
    const confirmation = usePasskeyConfirmation();
    seenOpen.push(confirmation.open);
    return {
      confirmation,
      first: useQuery({ queryKey: ["first"], queryFn: first }),
      second: useQuery({ queryKey: ["second"], queryFn: second, enabled: showSecond }),
    };
  });
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  act(() => result.current.confirmation.confirm());
  expect(result.current.confirmation.pending).toBe(true);

  // Another part of the screen loads, and fails, while the browser's dialog is open.
  showSecond = true;
  rerender();
  await waitFor(() => expect(result.current.second.isError).toBe(true));
  await act(async () => {
    confirmed = true;
    finish({ ok: true });
  });

  await waitFor(() => expect(result.current.second.data).toBe("tweede"));
  expect(result.current.first.data).toBe("eerste");
  expect(result.current.confirmation.open).toBe(false);
  expect(timesOpened(seenOpen)).toBe(1);
  expect(authenticateWithPasskey).toHaveBeenCalledOnce();
});

test("a mutation that failed with passkey_required runs again after confirm, and its useMutation shows success", async () => {
  const mutationFn = vi.fn(async (name: string) => {
    if (!confirmed) throw required;
    return `${name} is toegevoegd`;
  });
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    add: useMutation({ mutationFn }),
  }));
  act(() => result.current.add.mutate("Kim"));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  expect(result.current.add.isError).toBe(true);

  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
  expect(result.current.add.data).toBe("Kim is toegevoegd");
  expect(mutationFn.mock.calls.map(([name]) => name)).toEqual(["Kim", "Kim"]);
});

test("a query with backgroundRequestMeta never opens the modal", async () => {
  const queryFn = vi.fn(async () => {
    throw required;
  });
  const mutationFn = vi.fn(async () => {
    throw required;
  });
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    badge: useQuery({ queryKey: ["badge"], queryFn, meta: backgroundRequestMeta }),
    background: useMutation({ mutationFn, meta: backgroundRequestMeta }),
  }));
  await waitFor(() => expect(result.current.badge.isError).toBe(true));
  act(() => result.current.background.mutate());
  await waitFor(() => expect(result.current.background.isError).toBe(true));
  expect(result.current.confirmation.open).toBe(false);
  // Not retried either: the error is the answer.
  expect(queryFn).toHaveBeenCalledOnce();
});

test("cancel closes the modal and the query keeps its error", async () => {
  const queryFn = guarded("de leden");
  const { result, queryClient } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    members: useQuery({ queryKey: ["members"], queryFn }),
  }));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));

  act(() => result.current.confirmation.cancel());

  expect(result.current.confirmation.open).toBe(false);
  expect(result.current.members.error).toEqual(required);
  expect(authenticateWithPasskey).not.toHaveBeenCalled();

  // A later confirmation refetches everything on screen, so the query too.
  act(() => requestPasskeyConfirmation(queryClient));
  expect(result.current.confirmation.open).toBe(true);
  await act(async () => result.current.confirmation.confirm());
  await waitFor(() => expect(result.current.members.data).toBe("de leden"));
  expect(result.current.confirmation.open).toBe(false);
  expect(queryFn).toHaveBeenCalledTimes(2);
});

test("confirm twice while pending starts one ceremony", async () => {
  let finish: (result: PasskeyResult) => void = () => {};
  vi.mocked(authenticateWithPasskey).mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const { result, queryClient } = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(count("GET /api/me")).toBe(1));
  act(() => requestPasskeyConfirmation(queryClient));

  act(() => {
    result.current.confirm();
    result.current.confirm();
  });
  act(() => result.current.confirm());

  expect(result.current.pending).toBe(true);
  expect(authenticateWithPasskey).toHaveBeenCalledOnce();
  await act(async () => finish({ ok: true }));
  expect(result.current).toMatchObject({ open: false, pending: false });
});

test("a failed ceremony keeps the modal open with its error", async () => {
  vi.mocked(authenticateWithPasskey).mockResolvedValueOnce({ ok: false, error: "cancelled" });
  const queryFn = guarded("de leden");
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    members: useQuery({ queryKey: ["members"], queryFn }),
  }));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));

  await act(async () => result.current.confirmation.confirm());

  expect(result.current.confirmation).toMatchObject({
    open: true,
    pending: false,
    error: "cancelled",
  });
  expect(queryFn).toHaveBeenCalledOnce();

  // A second try clears the error and goes through.
  await act(async () => result.current.confirmation.confirm());
  await waitFor(() => expect(result.current.members.data).toBe("de leden"));
  expect(result.current.confirmation).toMatchObject({ open: false, error: null });
});

test("without a passkey, confirm creates one; with one, it authenticates", async () => {
  me = withoutPasskey;
  const without = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(without.result.current.hasPasskey).toBe(false));
  await waitFor(() => expect(count("GET /api/me")).toBe(1));
  act(() => requestPasskeyConfirmation(without.queryClient));
  await act(async () => without.result.current.confirm());
  expect(createPasskey).toHaveBeenCalledOnce();
  expect(authenticateWithPasskey).not.toHaveBeenCalled();
  without.unmount();

  vi.clearAllMocks();
  me = withPasskey;
  const withOne = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(withOne.result.current.hasPasskey).toBe(true));
  act(() => requestPasskeyConfirmation(withOne.queryClient));
  await act(async () => withOne.result.current.confirm());
  expect(authenticateWithPasskey).toHaveBeenCalledOnce();
  expect(createPasskey).not.toHaveBeenCalled();
});

test.each([
  {
    name: "a passkey that is gone (unknown_passkey) makes the next try create one",
    stale: withPasskey,
    fresh: withoutPasskey,
    error: "unknown_passkey" as const,
  },
  {
    name: "a passkey added elsewhere (confirmation_required) makes the next try authenticate",
    stale: withoutPasskey,
    fresh: withPasskey,
    error: "confirmation_required" as const,
  },
])("$name: me is refetched, the error shows", async ({ stale, fresh, error }) => {
  me = stale;
  const first = stale.user.hasPasskey ? authenticateWithPasskey : createPasskey;
  const second = stale.user.hasPasskey ? createPasskey : authenticateWithPasskey;
  vi.mocked(first).mockResolvedValueOnce({ ok: false, error });
  const { result, queryClient } = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(result.current.hasPasskey).toBe(stale.user.hasPasskey));
  act(() => requestPasskeyConfirmation(queryClient));
  me = fresh;

  await act(async () => result.current.confirm());

  expect(result.current).toMatchObject({ open: true, pending: false, error });
  await waitFor(() => expect(result.current.hasPasskey).toBe(fresh.user.hasPasskey));
  expect(count("GET /api/me")).toBe(2);
  await act(async () => result.current.confirm());
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  expect(result.current.open).toBe(false);
});

test("another failed ceremony does not refetch me", async () => {
  vi.mocked(authenticateWithPasskey).mockResolvedValueOnce({ ok: false, error: "cancelled" });
  const { result, queryClient } = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(count("GET /api/me")).toBe(1));
  act(() => requestPasskeyConfirmation(queryClient));
  await act(async () => result.current.confirm());
  expect(result.current.error).toBe("cancelled");
  expect(count("GET /api/me")).toBe(1);
});

test("after a confirmation me is refetched and the event stream reopens", async () => {
  FakeEventSource.instances = [];
  const onOpen = vi.fn();
  const close = subscribeToServerEvents(
    { onOpen },
    { EventSourceImpl: FakeEventSource as unknown as typeof EventSource },
  );
  const { result, queryClient } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    passkeys: useQuery(listPasskeysOptions()),
  }));
  await waitFor(() => expect(result.current.passkeys.isSuccess).toBe(true));
  expect(count("GET /api/me")).toBe(1);
  act(() => requestPasskeyConfirmation(queryClient));

  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(count("GET /api/me")).toBe(2));
  await waitFor(() => expect(count("GET /api/passkeys")).toBe(2));
  const [old, reopened] = FakeEventSource.instances;
  expect(old!.closed).toBe(true);
  expect(reopened?.closed).toBe(false);
  reopened!.onopen?.();
  expect(onOpen).toHaveBeenCalledOnce();
  close();
});

test("logInAgain logs out and closes the modal", async () => {
  vi.mocked(createPasskey).mockResolvedValueOnce({ ok: false, error: "session_too_old" });
  me = withoutPasskey;
  const { result, queryClient } = setup(() => usePasskeyConfirmation());
  await waitFor(() => expect(count("GET /api/me")).toBe(1));
  act(() => requestPasskeyConfirmation(queryClient));
  await act(async () => result.current.confirm());
  expect(result.current.error).toBe("session_too_old");

  await act(async () => result.current.logInAgain());

  expect(result.current.open).toBe(false);
  await waitFor(() => expect(count("POST /api/auth/sign-out")).toBe(1));
  await waitFor(() => expect(count("GET /api/me")).toBe(2));
});

test("after cancel, a window focus does not reopen the modal; an explicit refetch does", async () => {
  const queryFn = guarded("de leden");
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    members: useQuery({ queryKey: ["members"], queryFn }),
  }));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  act(() => result.current.confirmation.cancel());

  try {
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    // Give a refetch the time to start and fail.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(queryFn).toHaveBeenCalledOnce();
    expect(result.current.confirmation.open).toBe(false);
    expect(result.current.members.error).toEqual(required);
  } finally {
    focusManager.setFocused(undefined);
  }

  // "Probeer opnieuw": the person asks again, so the modal opens again.
  await act(async () => void (await result.current.members.refetch()));
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(result.current.confirmation.open).toBe(true);
});

test("when the me query finds the session gone, an open confirmation is cancelled", async () => {
  const mutationFn = vi.fn(async () => {
    if (!confirmed) throw required;
    return "toegevoegd";
  });
  const { result, queryClient } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    add: useMutation({ mutationFn }),
  }));
  act(() => result.current.add.mutate());
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));

  await act(async () => {
    await queryClient.fetchQuery({ queryKey: getMeQueryKey(), queryFn: async () => null });
  });

  expect(result.current.confirmation.open).toBe(false);
  // What waited is forgotten: a later confirmation does not send it again.
  act(() => requestPasskeyConfirmation(queryClient));
  await act(async () => result.current.confirmation.confirm());
  expect(mutationFn).toHaveBeenCalledOnce();
});

test.each([
  { name: "badge first", badgeFirst: true },
  { name: "page first", badgeFirst: false },
])(
  "a query observed by a background badge and by a page opens the modal ($name)",
  async ({ badgeFirst }) => {
    const queryFn = guarded("de werkgroepen");
    const badge = () => useQuery({ queryKey: ["groups"], queryFn, meta: backgroundRequestMeta });
    const page = () => useQuery({ queryKey: ["groups"], queryFn });
    const { result } = setup(() => {
      const confirmation = usePasskeyConfirmation();
      const [first, second] = badgeFirst ? [badge(), page()] : [page(), badge()];
      return { confirmation, first, second };
    });
    await waitFor(() => expect(result.current.first.isError).toBe(true));
    await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  },
);

test("a query observed only by the badge does not open the modal", async () => {
  confirmed = true;
  const queryFn = guarded("de werkgroepen");
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const badge = renderHook(
    () => ({
      confirmation: usePasskeyConfirmation(),
      badge: useQuery({ queryKey: ["groups"], queryFn, meta: backgroundRequestMeta }),
    }),
    { wrapper },
  );
  const page = renderHook(() => useQuery({ queryKey: ["groups"], queryFn }), { wrapper });
  await waitFor(() => expect(page.result.current.data).toBe("de werkgroepen"));
  // The page is left; the confirmation runs out; a live event refetches the badge's query, which
  // still has the page's options.
  page.unmount();
  confirmed = false;
  await act(async () => queryClient.invalidateQueries({ queryKey: ["groups"] }));
  await waitFor(() => expect(badge.result.current.badge.isError).toBe(true));
  expect(badge.result.current.confirmation.open).toBe(false);
});

test("a query without an observer (a prefetch) does not open the modal", async () => {
  const queryFn = guarded("de werkgroepen");
  const { result, queryClient } = setup(() => usePasskeyConfirmation());
  await act(async () => queryClient.prefetchQuery({ queryKey: ["groups"], queryFn }));
  expect(queryClient.getQueryState(["groups"])?.error).toEqual(required);
  expect(result.current.open).toBe(false);
});

test("after a confirmation every active query refetches, also one that never failed", async () => {
  const failing = guarded("de leden");
  const fine = vi.fn(async () => (confirmed ? "alles" : "een deel"));
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    members: useQuery({ queryKey: ["members"], queryFn: failing }),
    groups: useQuery({ queryKey: ["groups"], queryFn: fine }),
  }));
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  expect(result.current.groups.data).toBe("een deel");

  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.groups.data).toBe("alles"));
  await waitFor(() => expect(result.current.members.data).toBe("de leden"));
  expect(fine).toHaveBeenCalledTimes(2);
});

test("requestPasskeyConfirmation from an eye button, then confirm: the screen's queries refetch", async () => {
  const health = vi.fn(async () => (confirmed ? "met versies" : "zonder versies"));
  const { result, queryClient } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    health: useQuery({ queryKey: ["health"], queryFn: health }),
  }));
  await waitFor(() => expect(result.current.health.data).toBe("zonder versies"));

  act(() => requestPasskeyConfirmation(queryClient));
  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.health.data).toBe("met versies"));
  expect(result.current.confirmation.open).toBe(false);
});

test("after Annuleer, live events and a reopened stream do not reopen the modal; a confirmation refetches", async () => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  const workingGroupId = requestsForReviewFixture[0]!.workingGroup.id;
  const organizationId = requestsForReviewFixture[0]!.workingGroup.organization.id;
  const path = { path: { workingGroupId } };
  const managed = guarded({ workingGroups: [] });
  const members = guarded({ members: [] });
  const requests = guarded({ membershipRequests: [] });
  const { result, queryClient } = setup(() => {
    useAccessLiveUpdates();
    return {
      confirmation: usePasskeyConfirmation(),
      managed: useQuery({ queryKey: listManagedWorkingGroupsQueryKey(), queryFn: managed }),
      members: useQuery({ queryKey: listMembersQueryKey(path), queryFn: members }),
      requests: useQuery({ queryKey: listMembershipRequestsQueryKey(path), queryFn: requests }),
    };
  });
  await waitFor(() => expect(result.current.confirmation.open).toBe(true));
  await waitFor(() => expect(result.current.requests.isError).toBe(true));
  act(() => result.current.confirmation.cancel());

  const source = FakeEventSource.instances.at(-1)!;
  act(() => {
    source.emit("access-changed", JSON.stringify({ type: "access-changed", userId: me.user.id }));
    source.emit(
      "membership-requests-changed",
      JSON.stringify({ type: "membership-requests-changed", workingGroupId, organizationId }),
    );
    source.onopen?.();
  });
  // Give a refetch the time to start and fail.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(result.current.confirmation.open).toBe(false);
  for (const queryFn of [managed, members, requests]) expect(queryFn).toHaveBeenCalledOnce();
  // Me is never left alone.
  expect(count("GET /api/me")).toBeGreaterThan(1);

  act(() => requestPasskeyConfirmation(queryClient));
  await act(async () => result.current.confirmation.confirm());

  await waitFor(() => expect(result.current.requests.data).toEqual({ membershipRequests: [] }));
  await waitFor(() => expect(result.current.members.data).toEqual({ members: [] }));
  await waitFor(() => expect(result.current.managed.data).toEqual({ workingGroups: [] }));
});

test("useManagedWorkingGroups({ background: true }) never opens the modal", async () => {
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === "/api/managed-working-groups") {
        return Response.json(required, { status: 403 });
      }
      return answer(input, init);
    },
  });
  const { result } = setup(() => ({
    confirmation: usePasskeyConfirmation(),
    badge: useManagedWorkingGroups({ background: true }),
  }));
  await waitFor(() => expect(result.current.badge.isError).toBe(true));
  expect(apiErrorCode(result.current.badge.error)).toBe("passkey_required");
  expect(result.current.confirmation.open).toBe(false);
});

describe("useAdminConfirmationExpiry", () => {
  afterEach(() => vi.useRealTimers());

  test("me is refetched when adminConfirmedUntil passes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = Date.now();
    me = { ...withPasskey, adminConfirmedUntil: new Date(now + 60 * 60 * 1000).toISOString() };
    const { result } = setup(() => {
      useAdminConfirmationExpiry();
      return useMe();
    });
    await waitFor(() => expect(result.current.data).toEqual(me));
    const meFetches = () => count("GET /api/me");
    const before = meFetches();

    await act(async () => vi.advanceTimersByTimeAsync(59 * 60 * 1000));
    expect(meFetches()).toBe(before);

    me = { ...withPasskey, adminConfirmedUntil: null };
    await act(async () => vi.advanceTimersByTimeAsync(2 * 60 * 1000));
    await waitFor(() => expect(result.current.data?.adminConfirmedUntil).toBeNull());
    expect(meFetches()).toBe(before + 1);

    // Nothing to wait for any more.
    await act(async () => vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000));
    expect(meFetches()).toBe(before + 1);
  });
});
