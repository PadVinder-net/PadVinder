import { parseEnvelope } from "@sentry/core";
import { expect, test } from "vitest";
import { buildFeedbackEnvelope, type FeedbackInput } from "./feedback";

const DSN = "https://serverkey@o1.ingest.sentry.test/42";

const input: FeedbackInput = {
  message: "De knop doet niets",
  page: "/app/more",
  app: "portal",
  appVersion: "2027.1.0",
  userId: "0192f3c0-0000-7000-8000-000000000001",
  dsn: DSN,
  environment: "staging",
  release: "abc123",
};

function parsed(envelope: Uint8Array) {
  const [header, items] = parseEnvelope(envelope);
  expect(items).toHaveLength(1);
  const [itemHeader, payload] = items[0]!;
  return { header, itemHeader, payload: payload as Record<string, unknown> };
}

test("one feedback item with the message, the page and our tags, environment and release", () => {
  const before = Date.now();
  const { header, itemHeader, payload } = parsed(buildFeedbackEnvelope(input));
  expect(itemHeader).toEqual({ type: "feedback" });
  expect(header).toEqual({
    event_id: payload.event_id,
    sent_at: expect.any(String),
    dsn: DSN,
  });
  expect(Date.parse(header.sent_at as string)).toBeGreaterThanOrEqual(before - 1000);
  expect(payload.event_id).toMatch(/^[0-9a-f]{32}$/);
  expect(payload.timestamp).toBeGreaterThanOrEqual(before / 1000 - 1);
  expect(payload).toMatchObject({
    type: "feedback",
    level: "info",
    environment: "staging",
    release: "abc123",
    user: { id: input.userId },
    tags: { service: "portal", app_version: "2027.1.0" },
  });
  expect(payload.user).toEqual({ id: input.userId });
  expect((payload.contexts as Record<string, unknown>).feedback).toEqual({
    message: "De knop doet niets",
    url: "/app/more",
    source: "padvinder",
  });
});

test("every envelope gets a fresh event ID", () => {
  const first = parsed(buildFeedbackEnvelope(input)).payload.event_id;
  const second = parsed(buildFeedbackEnvelope(input)).payload.event_id;
  expect(first).not.toBe(second);
});

test("the crash's event ID becomes associated_event_id", () => {
  const eventId = "9ec79c33ec9942ab8353589fcb2e04dc";
  const { payload } = parsed(buildFeedbackEnvelope({ ...input, eventId }));
  expect(payload.contexts).toMatchObject({ feedback: { associated_event_id: eventId } });
  expect(payload.event_id).not.toBe(eventId);
});

test("the name and address only with a contact", () => {
  const withContact = parsed(
    buildFeedbackEnvelope({ ...input, contact: { name: "Noor", email: "noor@example.test" } }),
  ).payload;
  expect(withContact.contexts).toMatchObject({
    feedback: { name: "Noor", contact_email: "noor@example.test" },
  });
  const raw = new TextDecoder().decode(buildFeedbackEnvelope(input));
  expect(raw).not.toMatch(/contact_email|"name"/);
});

test("a contact without a name sends the address only", () => {
  const { payload } = parsed(
    buildFeedbackEnvelope({ ...input, contact: { name: "", email: "noor@example.test" } }),
  );
  const feedback = (payload.contexts as { feedback: Record<string, unknown> }).feedback;
  expect(feedback.contact_email).toBe("noor@example.test");
  expect(feedback).not.toHaveProperty("name");
});
