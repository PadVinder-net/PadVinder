import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { LoginFlow, type LoginResult } from "./login-flow";

const ok: LoginResult = { ok: true };

function setup(overrides: { logInWithCode?: () => Promise<LoginResult> } = {}) {
  const requestLoginCode = vi.fn(async (_email: string): Promise<LoginResult> => ok);
  const logInWithCode = vi.fn(overrides.logInWithCode ?? (async () => ok));
  const onLoggedIn = vi.fn();
  render(
    <LoginFlow
      requestLoginCode={requestLoginCode}
      logInWithCode={logInWithCode}
      onLoggedIn={onLoggedIn}
    />,
  );
  return { requestLoginCode, logInWithCode, onLoggedIn };
}

async function toCodeStep() {
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  await screen.findByRole("heading", { name: "Vul je code in" });
}

test("email, then code, then onLoggedIn", async () => {
  const { requestLoginCode, logInWithCode, onLoggedIn } = setup();
  await toCodeStep();
  expect(requestLoginCode).toHaveBeenCalledExactlyOnceWith("noor@example.test");
  await userEvent.type(screen.getByLabelText("Code"), "012345");
  expect(logInWithCode).toHaveBeenCalledExactlyOnceWith("noor@example.test", "012345");
  await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledOnce());
});
test("shows the message when the code is wrong and stays on the code step", async () => {
  const { onLoggedIn } = setup({
    logInWithCode: async () => ({
      ok: false,
      message: "Deze code klopt niet. Kijk nog eens in je mail.",
    }),
  });
  await toCodeStep();
  await userEvent.type(screen.getByLabelText("Code"), "123456");
  expect(await screen.findByRole("alert")).toHaveTextContent("Deze code klopt niet.");
  expect(screen.getByRole("heading", { name: "Vul je code in" })).toBeVisible();
  expect(onLoggedIn).not.toHaveBeenCalled();
});
test("shows the message when the code request fails and stays on the email step", async () => {
  const requestLoginCode = vi.fn(async (_email: string): Promise<LoginResult> => ({
    ok: false,
    message: "Het lukt nu niet.",
  }));
  render(
    <LoginFlow requestLoginCode={requestLoginCode} logInWithCode={vi.fn()} onLoggedIn={vi.fn()} />,
  );
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Het lukt nu niet.");
  expect(screen.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});
test("Ander e-mailadres goes back to the email step", async () => {
  setup();
  await toCodeStep();
  await userEvent.click(screen.getByRole("button", { name: "Ander e-mailadres" }));
  expect(screen.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});
test("Stuur opnieuw asks for a code for the same address", async () => {
  const { requestLoginCode } = setup();
  await toCodeStep();
  await userEvent.click(screen.getByRole("button", { name: "Stuur opnieuw" }));
  expect(requestLoginCode).toHaveBeenCalledTimes(2);
  expect(requestLoginCode).toHaveBeenLastCalledWith("noor@example.test");
  expect(await screen.findByText("We hebben de code opnieuw gestuurd.")).toBeVisible();
});
test("a double tap on Stuur code asks once", async () => {
  const { requestLoginCode } = setup();
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  const button = screen.getByRole("button", { name: "Stuur code" });
  await userEvent.dblClick(button);
  await screen.findByRole("heading", { name: "Vul je code in" });
  expect(requestLoginCode).toHaveBeenCalledOnce();
});
test("two submits in the same tick ask once", async () => {
  const { requestLoginCode } = setup();
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  const form = screen.getByRole("button", { name: "Stuur code" }).closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await screen.findByRole("heading", { name: "Vul je code in" });
  expect(requestLoginCode).toHaveBeenCalledOnce();
});
test("a rejected request shows the connection message and the user can retry", async () => {
  const requestLoginCode = vi
    .fn<(email: string) => Promise<LoginResult>>()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue(ok);
  render(
    <LoginFlow requestLoginCode={requestLoginCode} logInWithCode={vi.fn()} onLoggedIn={vi.fn()} />,
  );
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  await screen.findByRole("heading", { name: "Vul je code in" });
});
test("a rejected login shows the connection message and the same code can be sent again", async () => {
  const logInWithCode = vi
    .fn<(email: string, code: string) => Promise<LoginResult>>()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue(ok);
  const onLoggedIn = vi.fn();
  render(
    <LoginFlow
      requestLoginCode={async () => ok}
      logInWithCode={logInWithCode}
      onLoggedIn={onLoggedIn}
    />,
  );
  await toCodeStep();
  await userEvent.type(screen.getByLabelText("Code"), "123456");
  expect(await screen.findByRole("alert")).toHaveTextContent("Het lukt nu niet.");
  await userEvent.type(screen.getByLabelText("Code"), "123456");
  await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledOnce());
  expect(logInWithCode).toHaveBeenCalledTimes(2);
});
