import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ContactRows, mailHref, telHref } from "./contact-rows";

test("tel links keep a leading plus and drop separators", () => {
  expect(telHref("+31 6 1234 5678")).toBe("tel:+31612345678");
  expect(telHref("(010) 123-45.67")).toBe("tel:0101234567");
});
test("a phone with extra text gets no link", () => {
  expect(telHref("06 12 34 56 78 (na 18 uur)")).toBeUndefined();
  render(<ContactRows email="a@example.test" phone="06 12 34 56 78 (na 18 uur)" />);
  expect(screen.getByText("06 12 34 56 78 (na 18 uur)")).toBeVisible();
  expect(screen.queryByRole("link", { name: /na 18 uur/ })).toBeNull();
});
test("a mailto address keeps + and encodes a quote", () => {
  expect(mailHref(`o"brien+pad@example.test`)).toBe("mailto:o%22brien+pad@example.test");
});
