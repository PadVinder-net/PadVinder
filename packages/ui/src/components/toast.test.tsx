import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { showToast, Toaster } from "./toast";

test("showToast shows the message in the Toaster", async () => {
  render(<Toaster />);
  act(() => showToast("Soort bewaard."));
  expect(await screen.findByText("Soort bewaard.")).toBeInTheDocument();
});
