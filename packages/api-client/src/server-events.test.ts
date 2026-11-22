import { LIVE_EVENT_TYPES } from "@padvinder/contracts";
import { describe, expect, test, vi } from "vitest";
import { subscribeToServerEvents } from "./server-events";

// A second, fake union member, so the guard against a payload whose `type` differs from the SSE
// event name can be reached: with one member, such a payload fails the union parse first.
vi.mock("@padvinder/contracts", async (importOriginal) => {
  const { z } = await import("zod");
  const original = await importOriginal<typeof import("@padvinder/contracts")>();
  const testEvent = z.object({ type: z.literal("test-event") });
  return {
    ...original,
    liveEventSchema: z.discriminatedUnion("type", [...original.liveEventSchema.options, testEvent]),
    LIVE_EVENT_TYPES: [...original.LIVE_EVENT_TYPES, "test-event"],
  };
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
}

function subscribe(handlers: Parameters<typeof subscribeToServerEvents>[0]) {
  FakeEventSource.instances = [];
  const unsubscribe = subscribeToServerEvents(handlers, {
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
  });
  const source = FakeEventSource.instances[0]!;
  return { unsubscribe, source };
}

describe("subscribeToServerEvents", () => {
  test("opens /api/events by default", () => {
    expect(subscribe({}).source.url).toBe("/api/events");
  });

  test("registers one listener per live event type", () => {
    const { source } = subscribe({});
    expect([...source.listeners.keys()]).toEqual([...LIVE_EVENT_TYPES]);
  });

  test("dispatches an event to the handler for its type", () => {
    const received: unknown[] = [];
    const { source } = subscribe({
      events: { "worker-heartbeat": (event) => received.push(event) },
    });
    const event = { type: "worker-heartbeat", beatAt: "2027-03-01T19:31:00.000Z" };
    source.emit("worker-heartbeat", JSON.stringify(event));
    expect(received).toEqual([event]);
  });

  test("ignores a payload whose type differs from the SSE event name", () => {
    const received: unknown[] = [];
    const { source } = subscribe({
      events: {
        "worker-heartbeat": (event) => received.push(event),
        // The fake member is not part of the real handler types.
        ...({ "test-event": (event: unknown) => received.push(event) } as object),
      },
    });
    // Valid for the union, but not the type this listener is registered for.
    source.emit("worker-heartbeat", JSON.stringify({ type: "test-event" }));
    source.emit(
      "test-event",
      JSON.stringify({ type: "worker-heartbeat", beatAt: "2027-03-01T19:31:00.000Z" }),
    );
    expect(received).toEqual([]);
    source.emit("test-event", JSON.stringify({ type: "test-event" }));
    expect(received).toEqual([{ type: "test-event" }]);
  });

  test("ignores malformed JSON and schema mismatches without throwing", () => {
    const received: unknown[] = [];
    const { source } = subscribe({
      events: { "worker-heartbeat": (event) => received.push(event) },
    });
    expect(() => {
      source.emit("worker-heartbeat", "{not json");
      source.emit(
        "worker-heartbeat",
        JSON.stringify({ type: "worker-heartbeat", beatAt: "yesterday" }),
      );
      source.emit("worker-heartbeat", JSON.stringify({ other: 1 }));
    }).not.toThrow();
    expect(received).toEqual([]);
  });

  test("calls onOpen each time the connection opens", () => {
    let opened = 0;
    const { source } = subscribe({ onOpen: () => opened++ });
    source.onopen?.();
    source.onopen?.();
    expect(opened).toBe(2);
  });

  test("onClosed is called when the stream is closed for good", () => {
    let closed = 0;
    const { source } = subscribe({ onClosed: () => closed++ });
    // A non-200 answer (a 401 after logging out elsewhere): the browser gives up.
    source.readyState = 2;
    source.onerror?.();
    expect(closed).toBe(1);
  });

  test("onClosed is not called while the browser is reconnecting", () => {
    let closed = 0;
    const { source } = subscribe({ onClosed: () => closed++ });
    source.readyState = 0;
    source.onerror?.();
    expect(closed).toBe(0);
  });

  test("the returned function closes the EventSource", () => {
    const { unsubscribe, source } = subscribe({});
    unsubscribe();
    expect(source.closed).toBe(true);
  });
});
