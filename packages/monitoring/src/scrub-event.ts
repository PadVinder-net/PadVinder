import { scrub } from "@padvinder/logging";

const MAX_DEPTH = 12;
// Span attributes the SDK sets whatever `dataCollection` says. The user agent identifies a
// person's device and browser; a query string or fragment can hold an address or a phone number.
const DROPPED_SPAN_ATTRIBUTES = [
  "user_agent.original",
  "url.query",
  "http.query",
  "url.fragment",
  "http.fragment",
];
// Keys whose value is a URL or a request target, wherever they appear (span and trace data,
// `request.url`, the pino context's `req.url`, breadcrumb data). Their query and fragment are cut
// off: Sentry's Fastify instrumentation sets `url.path` to the raw `request.url`, query and all,
// whatever `urlQueryParams` says.
const URL_KEYS: ReadonlySet<string> = new Set([
  "url.path",
  "url.full",
  "http.target",
  "http.url",
  "url",
]);
// In the data of a navigation breadcrumb (the browser's), `from` and `to` are page URLs too.
// Elsewhere these keys can hold anything, so they are cut only there.
const NAVIGATION_URL_KEYS: ReadonlySet<string> = new Set([...URL_KEYS, "from", "to"]);
// Never sent to Sentry (the SDK's own working data), and large: passed on as it is.
const UNTOUCHED_KEYS = new Set(["sdkProcessingMetadata"]);

/** Before an address in a URL: `%40` is `@`. */
function scrubText(text: string): string {
  return scrub(text.includes("%") ? text.replace(/%40/gi, "@") : text);
}

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

// CSS selectors the SDK writes for an element (`htmlTreeAsString`): a tap's breadcrumb message and
// the web vitals' elements (`lcp.element`, `cls.source.N`, `browser.web_vital.*`). They hold
// attribute values such as `[aria-label="Acties voor Anne de Vries"]`.
const SELECTOR_KEY = /^(?:lcp\.element|cls\.source\.\d+|browser\.web_vital\..+)$/;
// An attribute with its value, up to the `"]` that the next attribute, the next element or the
// end follows.
const ATTRIBUTE_VALUE = /\[([\w-]+)="[\s\S]*?"\](?=\[|\s>\s|$)/g;

/**
 * A selector with attribute names only: `button[aria-label]`. A selector that still holds a quote
 * afterwards (a value with `"]` in it) becomes `[element]` as a whole.
 */
export function withoutAttributeValues(selector: string): string {
  const stripped = selector.replace(ATTRIBUTE_VALUE, "[$1]");
  return stripped.includes('"') ? "[element]" : stripped;
}

function isTap(category: unknown): boolean {
  return category === "ui.click" || category === "ui.input";
}

/**
 * The rules for breadcrumbs, applied to a scrubbed copy: a tap keeps its message as a selector
 * without attribute values and no data; a console breadcrumb loses the raw `arguments` (its message
 * is the scrubbed text of them).
 */
function trimBreadcrumb(copy: Record<string, unknown>): void {
  if (isTap(copy.category)) {
    delete copy.data;
    if (typeof copy.message === "string") copy.message = withoutAttributeValues(copy.message);
  } else if (copy.category === "console" && typeof copy.data === "object" && copy.data !== null) {
    delete (copy.data as Record<string, unknown>).arguments;
  }
}

/**
 * Every string through `scrub` (with `%40` read as `@`), URL values (`key` in `urlKeys`, chosen by
 * the parent) without their query and fragment; keys stay as they are. Cycles and deep nesting
 * become markers. `navigationData` marks the `data` object of a navigation breadcrumb.
 */
function scrubValue(
  value: unknown,
  depth: number,
  ancestors: object[],
  key: string | undefined,
  urlKeys: ReadonlySet<string> = URL_KEYS,
  navigationData = false,
): unknown {
  if (typeof value === "string") {
    if (key !== undefined && SELECTOR_KEY.test(key))
      return withoutAttributeValues(scrubText(value));
    return scrubText(key !== undefined && urlKeys.has(key) ? withoutQuery(value) : value);
  }
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.includes(value)) return "[circular]";
  if (depth > MAX_DEPTH) return "[depth]";
  ancestors.push(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubValue(item, depth + 1, ancestors, undefined));
    }
    const copy: Record<string, unknown> = {};
    const childUrlKeys = navigationData ? NAVIGATION_URL_KEYS : URL_KEYS;
    const navigation = (value as { category?: unknown }).category === "navigation";
    for (const [itemKey, item] of Object.entries(value)) {
      copy[itemKey] =
        depth === 0 && UNTOUCHED_KEYS.has(itemKey)
          ? item
          : scrubValue(
              item,
              depth + 1,
              ancestors,
              itemKey,
              childUrlKeys,
              navigation && itemKey === "data",
            );
    }
    trimBreadcrumb(copy);
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
 * A scrubbed copy of a Sentry event (or transaction): every string through `scrub` (a
 * percent-encoded address too), every URL (`URL_KEYS`) without its query and fragment, and no
 * request headers, cookies, body or query string, no user field but `id`, and no span attribute
 * of `DROPPED_SPAN_ATTRIBUTES` (in the trace context and in every span). `sdkProcessingMetadata`
 * is kept as it is: the SDK never sends it.
 */
export function scrubEvent<T>(event: T): T {
  const copy = scrubValue(event, 0, [], undefined) as T & WithRequestAndUser;
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

/** A scrubbed copy of any JSON value: as `scrubEvent` does with strings and URLs. */
export function scrubStrings<T>(value: T): T {
  return scrubValue(value, 0, [], undefined) as T;
}

/** A scrubbed copy of a breadcrumb: as `scrubEvent` does with strings and URLs. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return scrubStrings(breadcrumb);
}
