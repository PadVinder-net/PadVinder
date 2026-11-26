import { scrub } from "@padvinder/logging";

const MAX_DEPTH = 12;
// Span attributes the SDK sets whatever `dataCollection` says. The user agent identifies a
// person's device and browser.
const DROPPED_SPAN_ATTRIBUTES = ["user_agent.original"];

/** Every string through `scrub`; keys stay as they are. Cycles and deep nesting become markers. */
function scrubValue(value: unknown, depth: number, ancestors: object[]): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.includes(value)) return "[circular]";
  if (depth > MAX_DEPTH) return "[depth]";
  ancestors.push(value);
  try {
    if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, ancestors));
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = scrubValue(item, depth + 1, ancestors);
    }
    return copy;
  } finally {
    ancestors.pop();
  }
}

type WithRequestAndUser = {
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  contexts?: { trace?: { data?: unknown } };
  spans?: unknown;
};

function dropSpanAttributes(data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  for (const key of DROPPED_SPAN_ATTRIBUTES) delete (data as Record<string, unknown>)[key];
}

/**
 * A scrubbed copy of a Sentry event (or transaction): every string through `scrub`, and no
 * request headers, cookies, body or query string, no user field but `id`, and no span attribute
 * of `DROPPED_SPAN_ATTRIBUTES` (in the trace context and in every span).
 */
export function scrubEvent<T>(event: T): T {
  const copy = scrubValue(event, 0, []) as T & WithRequestAndUser;
  if (copy.request && typeof copy.request === "object") {
    delete copy.request.headers;
    delete copy.request.cookies;
    delete copy.request.data;
    delete copy.request.query_string;
  }
  if (copy.user && typeof copy.user === "object") {
    copy.user = copy.user.id === undefined ? {} : { id: copy.user.id };
  }
  dropSpanAttributes(copy.contexts?.trace?.data);
  if (Array.isArray(copy.spans)) {
    for (const span of copy.spans) dropSpanAttributes((span as { data?: unknown } | null)?.data);
  }
  return copy;
}

/** A scrubbed copy of a breadcrumb: every string through `scrub`. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return scrubValue(breadcrumb, 0, []) as T;
}
