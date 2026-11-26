import { scrub } from "@padvinder/logging/scrub";

// The browser's copy of the rules in @padvinder/monitoring's scrub-event.ts (which the browser
// cannot import: it loads @sentry/node). The tunnel runs those rules again on the server.

const MAX_DEPTH = 12;
// A URL's query or fragment can hold an address or a phone number; the user agent identifies a
// device. Dropped wherever they appear.
const DROPPED_KEYS = new Set([
  "user_agent.original",
  "url.query",
  "http.query",
  "url.fragment",
  "http.fragment",
]);
// Keys whose value is a URL: their query and fragment are cut off.
const URL_KEYS: ReadonlySet<string> = new Set([
  "url",
  "url.full",
  "url.path",
  "http.url",
  "http.target",
]);
// In the data of a navigation breadcrumb, `from` and `to` are page URLs too.
const NAVIGATION_URL_KEYS: ReadonlySet<string> = new Set([...URL_KEYS, "from", "to"]);
// The attributes whose names (never their values) a tap's breadcrumb keeps, as the SDK lists them.
const ELEMENT_ATTRIBUTES = ["type", "aria-label", "title", "name", "alt"];
const MAX_ELEMENTS = 5;

/** `%40` is `@` in a URL, so a percent-encoded address is scrubbed too. */
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
 * Every string through `scrubText`, URL values (`key` in `urlKeys`, chosen by the parent) without
 * their query and fragment. `navigationData` marks the `data` object of a navigation breadcrumb.
 */
function scrubValue(
  value: unknown,
  depth: number,
  ancestors: object[],
  key: string | undefined,
  urlKeys: ReadonlySet<string>,
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
      return value.map((item) => scrubValue(item, depth + 1, ancestors, undefined, URL_KEYS));
    }
    const childUrlKeys = navigationData ? NAVIGATION_URL_KEYS : URL_KEYS;
    const navigation = (value as { category?: unknown }).category === "navigation";
    const copy: Record<string, unknown> = {};
    for (const [itemKey, item] of Object.entries(value)) {
      if (DROPPED_KEYS.has(itemKey)) continue;
      // `sdkProcessingMetadata` is the SDK's own working data, never sent, and large.
      copy[itemKey] =
        depth === 0 && itemKey === "sdkProcessingMetadata"
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

/**
 * A scrubbed copy of any value: every string through `scrub` (a percent-encoded address too),
 * every URL without its query and fragment (also `from` and `to` of a navigation breadcrumb), and
 * without the keys of a query, a fragment or the user agent. Cycles and deep nesting become
 * markers.
 */
export function scrubStrings<T>(value: T): T {
  return scrubValue(value, 0, [], undefined, URL_KEYS) as T;
}

type BrowserEvent = {
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
};

/**
 * A scrubbed copy of an event or transaction (`scrubStrings`), without request headers (the
 * user agent and referrer the SDK adds), cookies, body or query string, and with no user field
 * but `id` (no user at all without one).
 */
export function scrubBrowserEvent<T>(event: T): T {
  const copy = scrubStrings(event) as T & BrowserEvent;
  if (copy.request && typeof copy.request === "object") {
    delete copy.request.headers;
    delete copy.request.cookies;
    delete copy.request.data;
    delete copy.request.query_string;
  }
  if (copy.user && typeof copy.user === "object") {
    if (copy.user.id === undefined) delete copy.user;
    else copy.user = { id: copy.user.id };
  }
  return copy;
}

function elementAsString(element: Element): string {
  let text = element.tagName.toLowerCase();
  for (const name of ELEMENT_ATTRIBUTES) if (element.hasAttribute(name)) text += `[${name}]`;
  return text;
}

/**
 * The path to a tapped element as tag names and the names of its `type` and labelling attributes,
 * never their values, the element's text, its id or its classes: those can hold a person's name.
 */
export function elementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current !== null && parts.length < MAX_ELEMENTS) {
    if (current.tagName.toLowerCase() === "html") break;
    parts.push(elementAsString(current));
    current = current.parentElement;
  }
  return parts.reverse().join(" > ");
}

function tappedElement(hint: { event?: unknown } | undefined): Element | undefined {
  if (typeof Element === "undefined") return undefined;
  const event = hint?.event;
  const target = typeof Event !== "undefined" && event instanceof Event ? event.target : event;
  return target instanceof Element ? target : undefined;
}

type Breadcrumb = { category?: string; message?: string; data?: unknown };

/**
 * A scrubbed copy of a breadcrumb (`scrubStrings`). A tap or a key press (`ui.click`,
 * `ui.input`) keeps only the element's path (`elementPath`) and no data.
 */
export function scrubBrowserBreadcrumb<T extends Breadcrumb>(
  breadcrumb: T,
  hint?: { event?: unknown },
): T {
  if (breadcrumb.category === "ui.click" || breadcrumb.category === "ui.input") {
    const element = tappedElement(hint);
    const { data: _data, ...rest } = breadcrumb;
    return { ...rest, message: element ? elementPath(element) : "[element]" } as T;
  }
  return scrubStrings(breadcrumb);
}
