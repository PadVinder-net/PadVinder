import {
  LIVE_EVENT_TYPES,
  liveEventSchema,
  type LiveEvent,
  type LiveEventType,
} from "@padvinder/contracts";

/** One optional handler per event type; a new union member in `liveEventSchema` adds a key. */
export type LiveEventHandlers = {
  [T in LiveEventType]?: (event: Extract<LiveEvent, { type: T }>) => void;
};

export type ServerEventHandlers = {
  /** Called each time the connection opens, also after a reconnect. */
  onOpen?: () => void;
  /**
   * Called when the browser has given up on the stream: the server answered with an error, such
   * as 401 after the session ended, instead of opening it. The stream is opened again after a
   * pause, so this may be called more than once.
   */
  onClosed?: () => void;
  events?: LiveEventHandlers;
};

export type SubscribeOptions = {
  url?: string;
  EventSourceImpl?: typeof EventSource;
  /** Pauses before opening a given-up stream again, in ms; the last one repeats. */
  reconnectDelays?: readonly number[];
};

/** The open subscriptions, each with the function that opens its stream again at once. */
const openSubscriptions = new Set<() => void>();

/**
 * Closes every open stream and opens it again at once, which calls its `onOpen` (and so refetches).
 * After a passkey confirmation: the old streams were opened with the session it replaced, which no
 * longer exists, and would only notice at their next check.
 */
export function reopenServerEvents(): void {
  for (const reopen of openSubscriptions) reopen();
}

/** Up to a minute, so a server that is down for a while is not asked every few seconds. */
const RECONNECT_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

/**
 * Opens the server-sent events stream. After a dropped connection the browser reconnects by
 * itself. But when the server answers a reconnect with an error (401, 500), the browser closes the
 * stream for good; then this opens it again after a pause (`reconnectDelays`) and calls
 * `onClosed`. Events sent in the meantime are lost, so use `onOpen` to refetch what the events
 * would have updated. Payloads that are not valid JSON, do not match the contract, or whose
 * `type` differs from the SSE event name are ignored. Returns a function that closes the
 * connection.
 */
export function subscribeToServerEvents(
  handlers: ServerEventHandlers,
  options: SubscribeOptions = {},
): () => void {
  const {
    url = "/api/events",
    EventSourceImpl = EventSource,
    reconnectDelays = RECONNECT_DELAYS_MS,
  } = options;
  let source: EventSource;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function connect() {
    const current = new EventSourceImpl(url);
    source = current;
    current.onopen = () => {
      // A stream replaced by `reopenServerEvents` is done.
      if (current !== source) return;
      failures = 0;
      handlers.onOpen?.();
    };
    current.onerror = () => {
      // CONNECTING means the browser retries by itself; CLOSED means it gave up.
      if (current !== source || current.readyState !== EventSourceImpl.CLOSED || stopped) return;
      current.close();
      const delay = reconnectDelays[Math.min(failures, reconnectDelays.length - 1)] ?? 0;
      failures++;
      timer = setTimeout(connect, delay);
      handlers.onClosed?.();
    };
    for (const type of LIVE_EVENT_TYPES) {
      current.addEventListener(type, (message) => {
        let payload: unknown;
        try {
          payload = JSON.parse((message as MessageEvent<string>).data);
        } catch {
          return;
        }
        const parsed = liveEventSchema.safeParse(payload);
        if (!parsed.success || parsed.data.type !== type) return;
        // TypeScript cannot correlate the union member with its handler, hence the cast.
        const handler = handlers.events?.[type] as ((event: LiveEvent) => void) | undefined;
        handler?.(parsed.data);
      });
    }
  }

  function reopen() {
    clearTimeout(timer);
    source.close();
    failures = 0;
    connect();
  }

  connect();
  openSubscriptions.add(reopen);
  return () => {
    stopped = true;
    openSubscriptions.delete(reopen);
    clearTimeout(timer);
    source.close();
  };
}
