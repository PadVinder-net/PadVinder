import { expect, test } from "vitest";
import { problemReportRequestSchema } from "./problem-reports";

const valid = {
  message: "  De knop doet niets  ",
  includeContact: false,
  page: "/app/more",
  appVersion: "2027.1.0",
  app: "app",
} as const;

test("accepts a report and trims the message", () => {
  expect(problemReportRequestSchema.parse(valid)).toEqual({
    ...valid,
    message: "De knop doet niets",
  });
});

test("accepts an event ID of 32 lowercase hex characters", () => {
  const eventId = "9ec79c33ec9942ab8353589fcb2e04dc";
  expect(problemReportRequestSchema.parse({ ...valid, eventId }).eventId).toBe(eventId);
});

test.each([
  ["an empty message", { message: "   " }],
  ["a message over 2000 characters", { message: "x".repeat(2001) }],
  ["an event ID that is not hex", { eventId: "not-an-event-id" }],
  ["an event ID with dashes", { eventId: "9ec79c33-ec99-42ab-8353-589fcb2e04dc" }],
  ["a page over 500 characters", { page: "/".repeat(501) }],
  ["an app version over 40 characters", { appVersion: "1".repeat(41) }],
  ["another app", { app: "worker" }],
  ["a name", { name: "Noor" }],
  ["an address", { email: "noor@example.test" }],
])("refuses %s", (_label, change) => {
  expect(problemReportRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
});

test("a message of 2000 characters is accepted", () => {
  expect(
    problemReportRequestSchema.parse({ ...valid, message: "x".repeat(2000) }).message,
  ).toHaveLength(2000);
});
