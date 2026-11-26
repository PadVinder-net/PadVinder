import { randomUUID } from "node:crypto";
import { serializeEnvelope, type Envelope } from "@sentry/core";
import type { DeploymentEnvironment } from "./settings";

export type FeedbackInput = {
  /** What went wrong, already scrubbed by the caller. */
  message: string;
  /** The name and address from the sender's profile, only when they chose to send them. */
  contact?: { name: string; email: string };
  /** The Sentry event ID of the crash the report is about. */
  eventId?: string;
  /** The path the user was on. */
  page: string;
  app: "app" | "portal";
  appVersion: string;
  /** The sender's account ID: the Sentry user, as for every other event. */
  userId: string;
  dsn: string;
  environment: DeploymentEnvironment;
  release: string;
};

/**
 * A Sentry envelope with one `feedback` item, the shape `captureFeedback` of `@sentry/core` makes
 * (`contexts.feedback`), built here so the caller posts it with `forwardEnvelope` and learns
 * whether Sentry took it. The user is only `{ id }`; `name` and `contact_email` are in it only
 * with `contact`, and `name` only when the profile has one.
 */
export function buildFeedbackEnvelope(input: FeedbackInput): Uint8Array {
  const eventId = randomUUID().replaceAll("-", "");
  const now = Date.now();
  const feedback: Record<string, string> = {
    message: input.message,
    url: input.page,
    source: "padvinder",
  };
  if (input.eventId !== undefined) feedback.associated_event_id = input.eventId;
  if (input.contact !== undefined) {
    if (input.contact.name !== "") feedback.name = input.contact.name;
    feedback.contact_email = input.contact.email;
  }
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    type: "feedback",
    level: "info",
    environment: input.environment,
    release: input.release,
    user: { id: input.userId },
    tags: { service: input.app, app_version: input.appVersion },
    contexts: { feedback },
  };
  const header = { event_id: eventId, sent_at: new Date(now).toISOString(), dsn: input.dsn };
  const serialized = serializeEnvelope([
    header,
    [[{ type: "feedback" }, event]],
  ] as unknown as Envelope);
  return typeof serialized === "string" ? new TextEncoder().encode(serialized) : serialized;
}
