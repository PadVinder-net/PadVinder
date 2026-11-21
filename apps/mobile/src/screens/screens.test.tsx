import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MapScreen } from "./map-screen";
import { ResultsScreen } from "./results-screen";
import { TonightScreen } from "./tonight-screen";

test.each([
  ["Vanavond", TonightScreen],
  ["Kaart", MapScreen],
  ["Resultaten", ResultsScreen],
])("%s is a placeholder with a title", (title, Screen) => {
  render(<Screen />);
  expect(screen.getByRole("heading", { level: 1, name: title })).toBeVisible();
  expect(screen.getByText("Komt binnenkort.")).toBeVisible();
});
