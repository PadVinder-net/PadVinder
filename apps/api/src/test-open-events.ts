export type SseEvent = { event: string; data: unknown };

export type EventsClient = {
  status: number;
  headers: Headers;
  /** Resolves with the next `event:`/`data:` frame; rejects after `timeoutMs`. Comments are skipped. */
  nextEvent(timeoutMs?: number): Promise<SseEvent>;
  /** Everything received so far, including comments and the `retry:` line. */
  received(): string;
  close(): void;
};

/** Opens `GET /api/events` and parses the stream. Test helper only. */
export async function openEvents(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<EventsClient> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/events`, { headers, signal: controller.signal });
  if (!res.ok) {
    // An error answer is a plain JSON body, not a stream.
    const body = (await res.text()) as string;
    return {
      status: res.status,
      headers: res.headers,
      received: () => body,
      close: () => controller.abort(),
      nextEvent: () => Promise.reject(new Error(`No stream: status ${res.status}`)),
    };
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let everything = "";
  const frames: SseEvent[] = [];
  let waiting: (() => void) | undefined;
  let ended = false;

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        everything += text;
        buffer += text;
        let index: number;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let event = "message";
          let data: string | undefined;
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (data !== undefined) frames.push({ event, data: JSON.parse(data) });
        }
        waiting?.();
      }
    } catch {
      // Aborted by close().
    }
    ended = true;
    waiting?.();
  })();

  return {
    status: res.status,
    headers: res.headers,
    received: () => everything,
    close: () => controller.abort(),
    async nextEvent(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (frames.length === 0) {
        if (ended) throw new Error("Stream ended before the next event");
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`No event within ${timeoutMs} ms`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remaining);
          waiting = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      return frames.shift()!;
    },
  };
}
