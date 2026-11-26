import { createTransport, parseEnvelope, type Envelope, type Event } from "@sentry/core";
import { itemsOfType } from "./fake-sentry";
import type { TransportFactory } from "./server";

export { startFakeSentry } from "./fake-sentry";

/** A transport that keeps every envelope in memory instead of sending it. */
export function createTestTransport(): {
  transport: TransportFactory;
  envelopes(): Envelope[];
  events(): Event[];
  transactions(): Event[];
} {
  const envelopes: Envelope[] = [];
  const transport: TransportFactory = (options) =>
    createTransport(options, async (request) => {
      envelopes.push(parseEnvelope(request.body));
      return { statusCode: 200 };
    });
  return {
    transport,
    envelopes: () => [...envelopes],
    events: () => itemsOfType(envelopes, "event"),
    transactions: () => itemsOfType(envelopes, "transaction"),
  };
}
