import {
  LIVE_EVENT_TYPES,
  liveEventSchema,
  type LiveEvent,
  type LiveEventType,
} from "@padvinder/contracts";

/** `EventSource.CLOSED`, as a literal so a stand-in implementation needs no static fields. */
const CLOSED = 2;

/** One optional handler per event type; a new union member in `liveEventSchema` adds a key. */
export type LiveEventHandlers = {
  [T in LiveEventType]?: (event: Extract<LiveEvent, { type: T }>) => void;
};

export type ServerEventHandlers = {
  /** Called each time the connection opens, also after an automatic reconnect. */
  onOpen?: () => void;
  /**
   * Called when the browser gives up on the stream: the server answered with a status other than
   * 200 (a 401 after logging out elsewhere), so it will not reconnect. Not called while it is
   * reconnecting after a dropped connection.
   */
  onClosed?: () => void;
  events?: LiveEventHandlers;
};

export type SubscribeOptions = {
  url?: string;
  EventSourceImpl?: typeof EventSource;
};

/**
 * Opens the server-sent events stream. The browser reconnects by itself; events sent in the
 * meantime are lost, so use `onOpen` to refetch what the events would have updated.
 * Payloads that are not valid JSON, do not match the contract, or whose `type` differs from the
 * SSE event name are ignored. Returns a function that closes the connection.
 */
export function subscribeToServerEvents(
  handlers: ServerEventHandlers,
  options: SubscribeOptions = {},
): () => void {
  const { url = "/api/events", EventSourceImpl = EventSource } = options;
  const source = new EventSourceImpl(url);

  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => {
    if (source.readyState === CLOSED) handlers.onClosed?.();
  };
  for (const type of LIVE_EVENT_TYPES) {
    source.addEventListener(type, (message) => {
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

  return () => source.close();
}
