import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { TabBar } from "./tab-bar";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>,
  );
}

test("tab bar has the four Dutch tabs with English paths", () => {
  renderAt("/");
  const tabs: Array<[string, string]> = [
    ["Vanavond", "/"],
    ["Kaart", "/map"],
    ["Resultaten", "/results"],
    ["Meer", "/more"],
  ];
  for (const [label, path] of tabs) {
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", path);
  }
});

test("only the current tab is marked as the current page", () => {
  renderAt("/map");
  expect(screen.getByRole("link", { name: "Kaart" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Vanavond" })).not.toHaveAttribute("aria-current");
});
