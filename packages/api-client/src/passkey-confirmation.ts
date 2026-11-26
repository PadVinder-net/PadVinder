import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type Mutation, type Query, type QueryClient } from "@tanstack/react-query";
import type { PasskeyError, PasskeyResult } from "@padvinder/contracts";
import { logOut } from "./auth-client";
import type { GetMeResponse } from "./generated";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";
import { refetchMe, useMe } from "./me-query";
import { authenticateWithPasskey, createPasskey } from "./passkey-client";
import { reopenServerEvents } from "./server-events";

/**
 * The `meta` of a query or mutation the person did not ask for (a badge in the navigation, a count
 * in the app's Meer menu). When it fails with `passkey_required` it never opens the confirmation:
 * it leaves out what it could not load.
 */
export const backgroundRequestMeta = { background: true } as const;

function isBackground(meta: Record<string, unknown> | undefined): boolean {
  return meta?.background === true;
}

/**
 * Whether a screen on display asked for a query: at least one of its observers lacks
 * `backgroundRequestMeta` in its own options. The portal's badge and the Werkgroepen page observe
 * one query, and only the page asks; the query's own `meta` is that of whichever observer fetched
 * last. A query without observers (a prefetch, or a refetch after its screen closed) was asked for
 * by no screen on display.
 */
function isAskedFor(query: Query<unknown, unknown, unknown>): boolean {
  return query.observers.some((observer) => !isBackground(observer.options.meta));
}

type ConfirmationState = { open: boolean; pending: boolean; error: PasskeyError | null };

/** A mutation of any type, as the cache reports it. */
type AnyMutation = Mutation<unknown, unknown, unknown>;

const closed: ConfirmationState = { open: false, pending: false, error: null };

/** The errors that say `confirm` chose the wrong ceremony: no passkey after all, or one already. */
const STALE_CHOICE_ERRORS = new Set<PasskeyError>(["unknown_passkey", "confirmation_required"]);

/**
 * The one confirmation of a query client: whether its modal is open, and the queries and mutations
 * that failed with `passkey_required` and wait for it. Reports while the modal is open, or while a
 * ceremony runs, join the same round.
 */
class ConfirmationStore {
  private state = closed;
  private readonly listeners = new Set<() => void>();
  private readonly mutations = new Set<AnyMutation>();
  /** Raised by `cancel`, so a ceremony that ends after it does not show its error. */
  private round = 0;

  constructor(private readonly queryClient: QueryClient) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(next: Partial<ConfirmationState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  open() {
    if (!this.state.open) this.set({ open: true, error: null });
  }

  reportMutation(mutation: AnyMutation) {
    this.mutations.add(mutation);
    this.open();
  }

  /** Closes the modal and forgets the reports: the queries and mutations keep their error. */
  cancel = () => {
    this.round++;
    this.mutations.clear();
    if (this.state.open || this.state.error) this.set({ open: false, error: null });
  };

  /** One ceremony at a time: a second call while one runs does nothing. */
  confirm = () => {
    if (this.state.pending || !this.state.open) return;
    const round = this.round;
    this.set({ pending: true, error: null });
    const me = this.queryClient.getQueryData<GetMeResponse | null>(getMeQueryKey());
    const ceremony = me?.user.hasPasskey ? authenticateWithPasskey : createPasskey;
    void ceremony().then((result) => this.finish(result, round));
  };

  private finish(result: PasskeyResult, round: number) {
    if (!result.ok) {
      this.set(round === this.round ? { pending: false, error: result.error } : { pending: false });
      // The ceremony was chosen from a stale `hasPasskey`: the passkey is gone (reset, removed),
      // or one was added elsewhere. Me is refetched, so the next try uses the other ceremony.
      if (STALE_CHOICE_ERRORS.has(result.error)) void refetchMe(this.queryClient);
      return;
    }
    // The session is confirmed now, also when the modal was cancelled meanwhile.
    // A mutation dropped from the cache meanwhile (by logging out) is not sent again.
    const cached = new Set<unknown>(this.queryClient.getMutationCache().getAll());
    const mutations = [...this.mutations].filter((mutation) => cached.has(mutation));
    this.mutations.clear();
    this.set(closed);
    // The session changed, so everything on screen may show more now: me, the queries that
    // failed, and those that left something out (an eye button has no failed request). Every
    // query, without the filter that live events use for queries waiting for a passkey.
    void this.queryClient.invalidateQueries();
    // The streams were opened with the session the confirmation replaced.
    reopenServerEvents();
    // Sent again with the same variables, so the screen's `useMutation` sees the result.
    for (const mutation of mutations) {
      mutation.execute(mutation.state.variables).catch(() => {});
    }
  }

  /** For a session too old to make a first passkey: log out, so the person logs in again. */
  logInAgain = () => {
    this.cancel();
    const queryClient = this.queryClient;
    // Whether or not signing out worked, me tells the gate what to show.
    void logOut().then(() => refetchMe(queryClient));
  };
}

const stores = new WeakMap<QueryClient, ConfirmationStore>();

function confirmationStore(queryClient: QueryClient): ConfirmationStore {
  let store = stores.get(queryClient);
  if (!store) {
    store = new ConfirmationStore(queryClient);
    stores.set(queryClient, store);
  }
  return store;
}

/**
 * Called by `createQueryClient`'s caches for every `passkey_required`. A query opens the modal
 * when a screen on display asked for it (`isAskedFor`), a mutation when its own `meta` is not
 * `backgroundRequestMeta`.
 */
export function reportPasskeyRequired(
  queryClient: QueryClient,
  failed: { query: Query<unknown, unknown, unknown> } | { mutation: AnyMutation },
): void {
  if ("query" in failed) {
    if (isAskedFor(failed.query)) confirmationStore(queryClient).open();
  } else if (!isBackground(failed.mutation.options.meta)) {
    confirmationStore(queryClient).reportMutation(failed.mutation);
  }
}

/** Closes the modal and forgets what waited for it: after the session ended. */
export function cancelPasskeyConfirmation(queryClient: QueryClient): void {
  confirmationStore(queryClient).cancel();
}

/**
 * Opens the modal without a failed request: for a screen that got `confirmation_required` from a
 * passkey call itself (adding a further passkey).
 */
export function requestPasskeyConfirmation(queryClient: QueryClient): void {
  confirmationStore(queryClient).open();
}

/**
 * The shared confirmation modal's state. `confirm()` uses the passkey when the person has one and
 * makes one otherwise, by me's `hasPasskey`. On success it closes the modal, invalidates every
 * query (the active ones refetch, me among them), reopens the event stream, and sends every
 * mutation that waited again. On failure the modal stays open with `error`; when the choice
 * came from a stale `hasPasskey` (`unknown_passkey`, `confirmation_required`), me is refetched,
 * so the next try uses the other ceremony.
 */
export function usePasskeyConfirmation(): {
  open: boolean;
  pending: boolean;
  error: PasskeyError | null;
  hasPasskey: boolean;
  confirm(): void;
  cancel(): void;
  logInAgain(): void;
} {
  const store = confirmationStore(useQueryClient());
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const me = useMe().data;
  return {
    ...state,
    hasPasskey: me?.user.hasPasskey ?? false,
    confirm: store.confirm,
    cancel: store.cancel,
    logInAgain: store.logInAgain,
  };
}

/** Longer than this, `setTimeout` fires at once (a signed 32-bit number of milliseconds). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** Me is asked a moment after the confirmation ran out, so the server's clock agrees. */
const EXPIRY_MARGIN_MS = 1000;
/** When me still reports a confirmation the device's clock says has passed: ask again after this. */
const EXPIRY_RECHECK_MS = 60 * 1000;

/**
 * Refetches me when `adminConfirmedUntil` passes, so the screens that read it (the app's lists,
 * which then name the groups of administered organizations without loading them) fall back without
 * a reload. One timer, set again whenever me is fetched. Mounted by both apps' confirmation hosts.
 */
export function useAdminConfirmationExpiry(): void {
  const queryClient = useQueryClient();
  const me = useMe();
  const until = me.data?.adminConfirmedUntil ?? null;
  const fetchedAt = me.dataUpdatedAt;
  useEffect(() => {
    if (until === null) return;
    const left = new Date(until).getTime() - Date.now();
    // A device clock ahead of the server's: me still says confirmed, so look again later.
    const delay = left > 0 ? left + EXPIRY_MARGIN_MS : EXPIRY_RECHECK_MS;
    const timer = setTimeout(() => void refetchMe(queryClient), Math.min(delay, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [queryClient, until, fetchedAt]);
}
