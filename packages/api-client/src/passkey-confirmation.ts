import { useSyncExternalStore } from "react";
import { useQueryClient, type Mutation, type QueryClient } from "@tanstack/react-query";
import type { PasskeyError, PasskeyResult } from "@padvinder/contracts";
import { logOut } from "./auth-client";
import type { GetMeResponse } from "./generated";
import { getMeQueryKey, listPasskeysQueryKey } from "./generated/@tanstack/react-query.gen";
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
  private readonly queryHashes = new Set<string>();
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

  reportQuery(queryHash: string) {
    this.queryHashes.add(queryHash);
    this.open();
  }

  reportMutation(mutation: AnyMutation) {
    this.mutations.add(mutation);
    this.open();
  }

  /** Closes the modal and forgets the reports: the queries and mutations keep their error. */
  cancel = () => {
    this.round++;
    this.queryHashes.clear();
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
    const queryHashes = [...this.queryHashes];
    // A mutation dropped from the cache meanwhile (by logging out) is not sent again.
    const cached = new Set<unknown>(this.queryClient.getMutationCache().getAll());
    const mutations = [...this.mutations].filter((mutation) => cached.has(mutation));
    this.queryHashes.clear();
    this.mutations.clear();
    this.set(closed);
    const queryClient = this.queryClient;
    void refetchMe(queryClient);
    // The streams were opened with the session the confirmation replaced.
    reopenServerEvents();
    void queryClient.invalidateQueries({
      predicate: (query) => queryHashes.includes(query.queryHash),
    });
    void queryClient.invalidateQueries({ queryKey: listPasskeysQueryKey() });
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
 * Called by `createQueryClient`'s caches for every error. A `passkey_required` of a query or
 * mutation the person asked for opens the modal; a background request's never does.
 */
export function reportPasskeyRequired(
  queryClient: QueryClient,
  failed:
    | { query: { queryHash: string; meta: Record<string, unknown> | undefined } }
    | { mutation: AnyMutation },
): void {
  if ("query" in failed) {
    if (!isBackground(failed.query.meta)) {
      confirmationStore(queryClient).reportQuery(failed.query.queryHash);
    }
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
 * makes one otherwise, by me's `hasPasskey`. On success it closes the modal, refetches me, reopens
 * the event stream, refetches every query that waited for it and the passkeys list, and sends
 * every mutation that waited again. On failure the modal stays open with `error`; when the choice
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
