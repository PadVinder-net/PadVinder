import { expect, test } from "vitest";
import {
  elementPath,
  scrubBrowserBreadcrumb,
  scrubBrowserEvent,
  scrubStrings,
  withoutAttributeValues,
} from "./scrub-event";

const QUERY = "?email=noor%40example.test&phone=0612345678#frag";

test("scrubs every string, a percent-encoded address too, and keeps keys and numbers", () => {
  expect(
    scrubStrings({
      message: "mail noor@example.test",
      extra: { "x@y.test": 1, url: `/a/b%40c.test` },
    }),
  ).toEqual({ message: "mail [email]", extra: { "x@y.test": 1, url: "/a/[email]" } });
});

test.each(["url", "url.full", "url.path", "http.url", "http.target"])(
  "cuts the query and fragment from %s",
  (key) => {
    expect(scrubStrings({ data: { [key]: `/api/x${QUERY}` } })).toEqual({
      data: { [key]: "/api/x" },
    });
  },
);

test("cuts the query from a navigation breadcrumb's from and to, in an event too", () => {
  const crumb = { category: "navigation", data: { from: `/app/more${QUERY}`, to: `/x${QUERY}` } };
  const expected = { category: "navigation", data: { from: "/app/more", to: "/x" } };
  expect(scrubBrowserBreadcrumb(crumb)).toEqual(expected);
  expect(scrubBrowserEvent({ breadcrumbs: [crumb] })).toEqual({ breadcrumbs: [expected] });
});

test("keeps the query of from and to elsewhere", () => {
  expect(
    scrubStrings({ category: "console", data: { from: "a?b" }, extra: { to: "c#d" } }),
  ).toEqual({ category: "console", data: { from: "a?b" }, extra: { to: "c#d" } });
});

test("drops query, fragment and user agent attributes wherever they are", () => {
  expect(
    scrubStrings({
      contexts: { trace: { data: { "url.query": "?a", "http.query": "a", ok: 1 } } },
      spans: [{ data: { "user_agent.original": "UA", "url.fragment": "x", "http.fragment": "y" } }],
    }),
  ).toEqual({ contexts: { trace: { data: { ok: 1 } } }, spans: [{ data: {} }] });
});

test("an event loses request headers, cookies, body and query, and user fields but id", () => {
  const result = scrubBrowserEvent({
    request: {
      url: `https://padvinder.test/app/more${QUERY}`,
      headers: { "User-Agent": "UA-MARKER", Referer: "https://padvinder.test/" },
      cookies: { s: "1" },
      data: "x",
      query_string: "email=a",
    },
    user: { id: "u1", ip_address: "{{auto}}", email: "x@y.test" },
  });
  expect(result).toEqual({
    request: { url: "https://padvinder.test/app/more" },
    user: { id: "u1" },
  });
});

test("an event with a user without an ID gets no user", () => {
  expect(scrubBrowserEvent({ user: { ip_address: "{{auto}}" } })).toEqual({});
});

test("survives cycles and depth, and keeps sdkProcessingMetadata as it is", () => {
  const cyclic: Record<string, unknown> = { name: "a@b.test" };
  cyclic.self = cyclic;
  let deep: Record<string, unknown> = { leaf: "c@d.test" };
  for (let i = 0; i < 20; i++) deep = { child: deep };
  const metadata = { anything: "e@f.test" };
  const result = scrubBrowserEvent({ extra: { cyclic, deep }, sdkProcessingMetadata: metadata });
  const text = JSON.stringify(result.extra);
  expect(text).toContain('"[circular]"');
  expect(text).toContain('"[depth]"');
  expect(text).not.toMatch(/@(b|d)\.test/);
  expect(result.sdkProcessingMetadata).toBe(metadata);
});

test("a tap keeps the element's path: tags and attribute names, no values or text", () => {
  document.body.innerHTML =
    '<div id="anne" class="anne"><a href="/x" title="Anne de Vries" alt="Anne">Anne</a><input type="checkbox" name="anne"></div>';
  const link = document.querySelector("a")!;
  const input = document.querySelector("input")!;
  expect(elementPath(link)).toBe("body > div > a[title][alt]");
  expect(elementPath(input)).toBe("body > div > input[type][name]");
  const event = new MouseEvent("click");
  Object.defineProperty(event, "target", { value: link });
  const crumb = {
    category: "ui.click",
    message: 'a[title="Anne de Vries"]',
    data: { "ui.component_name": "Anne" },
  };
  expect(scrubBrowserBreadcrumb(crumb, { event })).toEqual({
    category: "ui.click",
    message: "body > div > a[title][alt]",
  });
  expect(scrubBrowserBreadcrumb({ ...crumb, category: "ui.input" }, { event: input })).toEqual({
    category: "ui.input",
    message: "body > div > input[type][name]",
  });
  expect(scrubBrowserBreadcrumb(crumb)).toEqual({ category: "ui.click", message: "[element]" });
  document.body.innerHTML = "";
});

test("a type keeps its name only", () => {
  document.body.innerHTML = '<input type="Anne de Vries">';
  expect(elementPath(document.querySelector("input")!)).toBe("body > input[type]");
  document.body.innerHTML = "";
});

test("the path holds at most five elements", () => {
  document.body.innerHTML = "<div><div><div><div><div><span>x</span></div></div></div></div></div>";
  expect(elementPath(document.querySelector("span")!)).toBe("div > div > div > div > span");
  document.body.innerHTML = "";
});

test("web vitals' element selectors keep attribute names only", () => {
  const selector = 'body > li.row > button#x[aria-label="Acties voor Anne de Vries"][title="Anne"]';
  const result = scrubBrowserEvent({
    contexts: {
      trace: { data: { "lcp.element": selector, "cls.source.1": selector, "lcp.size": 10 } },
    },
    spans: [{ data: { "browser.web_vital.inp.target": selector, "cls.source.12": selector } }],
  });
  const stripped = "body > li.row > button#x[aria-label][title]";
  expect(result).toEqual({
    contexts: {
      trace: { data: { "lcp.element": stripped, "cls.source.1": stripped, "lcp.size": 10 } },
    },
    spans: [{ data: { "browser.web_vital.inp.target": stripped, "cls.source.12": stripped } }],
  });
});

test("a value with quotes is removed whole; one that looks like a next element gives [element]", () => {
  expect(withoutAttributeValues('button[aria-label="Anne "x"] de Vries"]')).toBe(
    "button[aria-label]",
  );
  expect(withoutAttributeValues('button[aria-label="Anne"] > de Vries"]')).toBe("[element]");
  expect(withoutAttributeValues('a[title="Anne"] > b[alt="x"]')).toBe("a[title] > b[alt]");
});

test("a tap breadcrumb in an event keeps the selector without values and no data", () => {
  const result = scrubBrowserEvent({
    breadcrumbs: [
      {
        category: "ui.click",
        message: 'body > button[aria-label="Anne de Vries"]',
        data: { "ui.component_name": "Anne" },
      },
    ],
  });
  expect(result).toEqual({
    breadcrumbs: [{ category: "ui.click", message: "body > button[aria-label]" }],
  });
});

test("a console breadcrumb loses its raw arguments", () => {
  expect(
    scrubStrings({
      category: "console",
      message: "x noor@example.test",
      data: { arguments: [{ name: "Anne" }], logger: "console" },
    }),
  ).toEqual({ category: "console", message: "x [email]", data: { logger: "console" } });
});
