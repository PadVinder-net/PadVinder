import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CrashScreen } from "./crash-screen";

test("the app's crash screen says the app got stuck and offers both buttons", async () => {
  const onReload = vi.fn();
  const onReport = vi.fn();
  render(<CrashScreen variant="app" onReload={onReload} onReport={onReport} />);
  expect(screen.getByRole("heading", { level: 1, name: "Er ging iets mis" })).toBeVisible();
  expect(
    screen.getByText(
      "De app liep vast. Laad de app opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Laad opnieuw" }));
  expect(onReload).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Vertel wat er gebeurde" }));
  expect(onReport).toHaveBeenCalledOnce();
});

test("the portal's crash screen speaks of the page", () => {
  render(<CrashScreen variant="portal" onReload={vi.fn()} onReport={vi.fn()} />);
  expect(
    screen.getByText(
      "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
});

test("without onReport (before login) only Laad opnieuw shows", () => {
  render(<CrashScreen variant="app" onReload={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Laad opnieuw" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Vertel wat er gebeurde" })).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
