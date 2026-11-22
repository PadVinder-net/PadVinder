import { LIVE_EVENT_TYPES } from "@padvinder/contracts";
import { describe, expect, test, vi } from "vitest";
import { FakeEventSource } from "./testing";
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

function subscribe(
  handlers: Parameters<typeof subscribeToServerEvents>[0],
  reconnectDelays?: number[],
) {
  FakeEventSource.instances = [];
  const unsubscribe = subscribeToServerEvents(handlers, {
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    reconnectDelays,
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

  test("the returned function closes the EventSource", () => {
    const { unsubscribe, source } = subscribe({});
    unsubscribe();
    expect(source.closed).toBe(true);
  });

  test("a dropped connection is left to the browser", () => {
    vi.useFakeTimers();
    try {
      const onClosed = vi.fn();
      const { source } = subscribe({ onClosed });
      source.fail(false);
      vi.runAllTimers();
      expect(onClosed).not.toHaveBeenCalled();
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(source.closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stream the browser gave up on is opened again after a growing pause", () => {
    vi.useFakeTimers();
    try {
      const onClosed = vi.fn();
      const { source } = subscribe({ onClosed }, [100, 300]);
      source.fail(true);
      expect(onClosed).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(99);
      expect(FakeEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances).toHaveLength(2);
      // It fails again: the next pause is longer, and the last one repeats.
      FakeEventSource.instances[1]!.fail(true);
      vi.advanceTimersByTime(299);
      expect(FakeEventSource.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      FakeEventSource.instances[2]!.fail(true);
      vi.advanceTimersByTime(300);
      expect(FakeEventSource.instances).toHaveLength(4);
      expect(onClosed).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an open stream resets the pause, and events reach the handlers again", () => {
    vi.useFakeTimers();
    try {
      const received: unknown[] = [];
      const { source } = subscribe(
        { events: { "worker-heartbeat": (event) => received.push(event) } },
        [100, 300],
      );
      source.fail(true);
      vi.advanceTimersByTime(100);
      const second = FakeEventSource.instances[1]!;
      second.onopen?.();
      const event = { type: "worker-heartbeat", beatAt: "2027-03-01T19:31:00.000Z" };
      second.emit("worker-heartbeat", JSON.stringify(event));
      expect(received).toEqual([event]);
      second.fail(true);
      vi.advanceTimersByTime(100);
      expect(FakeEventSource.instances).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("closing stops a pending reopen and closes the current stream", () => {
    vi.useFakeTimers();
    try {
      const { unsubscribe, source } = subscribe({}, [100]);
      source.fail(true);
      unsubscribe();
      vi.advanceTimersByTime(1_000);
      expect(FakeEventSource.instances).toHaveLength(1);
      const reopened = subscribe({}, [100]);
      reopened.source.fail(true);
      vi.advanceTimersByTime(100);
      reopened.unsubscribe();
      expect(FakeEventSource.instances[1]!.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
