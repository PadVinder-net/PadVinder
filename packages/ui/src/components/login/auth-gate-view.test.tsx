import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AuthGateView, type AuthGateViewProps } from "./auth-gate-view";

function renderView(overrides: Partial<AuthGateViewProps> = {}) {
  const props: AuthGateViewProps = {
    state: "app",
    onRetry: vi.fn(),
    login: {
      requestLoginCode: vi.fn(async () => ({ ok: true as const })),
      logInWithCode: vi.fn(async () => ({ ok: true as const })),
      onLoggedIn: vi.fn(),
    },
    saveName: { pending: false, failed: false, submit: vi.fn() },
    children: <p>de app</p>,
    ...overrides,
  };
  render(<AuthGateView {...props} />);
  return props;
}

test("shows the app only in the app state", () => {
  renderView();
  expect(screen.getByText("de app")).toBeVisible();
});

test("loading shows a text, not the app", () => {
  renderView({ state: "loading" });
  expect(screen.getByText("PadVinder laden…")).toBeVisible();
  expect(screen.queryByText("de app")).toBeNull();
});

test("failed shows the connection message and retries on a tap", async () => {
  const { onRetry } = renderView({ state: "failed" });
  expect(
    screen.getByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test("login shows the login steps", () => {
  renderView({ state: "login" });
  expect(screen.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});

test("name shows the name step, with the connection message after a failed save", () => {
  renderView({ state: "name", saveName: { pending: false, failed: true, submit: vi.fn() } });
  expect(screen.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Het lukt nu niet.");
});

test.each(["choose", "waiting"] as const)(
  "%s shows the applicant screens, or the app without them",
  (state) => {
    renderView({ state, applicant: <p>kies je werkgroep</p> });
    expect(screen.getByText("kies je werkgroep")).toBeVisible();
    expect(screen.queryByText("de app")).toBeNull();
  },
);

test("an applicant sees the app when there are no applicant screens", () => {
  renderView({ state: "choose" });
  expect(screen.getByText("de app")).toBeVisible();
});
