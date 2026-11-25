import { expect, test } from "vitest";
import { escapeHtml, paragraphsToHtml } from "./html";

test("escapeHtml escapes markup", () =>
  expect(escapeHtml(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;"));

test("paragraphsToHtml splits on blank lines and escapes", () =>
  expect(paragraphsToHtml("a <b>\n\nc & d")).toBe("<p>a &lt;b&gt;</p>\n<p>c &amp; d</p>"));
