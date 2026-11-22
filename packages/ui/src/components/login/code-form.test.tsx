import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CodeForm, type CodeFormProps } from "./code-form";

function setup(props: Partial<CodeFormProps> = {}) {
  const handlers = {
    onSubmit: vi.fn(),
    onResend: vi.fn(),
    onChangeEmail: vi.fn(),
  };
  const view = render(
    <CodeForm email="noor@example.test" pending={false} {...handlers} {...props} />,
  );
  return { ...handlers, ...view };
}

test("submits by itself at six digits, also when typed with a space", async () => {
  const { onSubmit } = setup();
  await userEvent.type(screen.getByLabelText("Code"), "123 456");
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("123456");
});
test("submits a pasted code once, with its leading zero", async () => {
  const { onSubmit } = setup();
  await userEvent.click(screen.getByLabelText("Code"));
  await userEvent.paste("012 345");
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("012345");
});
test("does not submit again on a re-render", async () => {
  const { onSubmit, rerender } = setup();
  await userEvent.type(screen.getByLabelText("Code"), "123456");
  rerender(
    <CodeForm
      email="noor@example.test"
      pending
      onSubmit={onSubmit}
      onResend={vi.fn()}
      onChangeEmail={vi.fn()}
    />,
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
test("does not submit five digits", async () => {
  const { onSubmit } = setup();
  await userEvent.type(screen.getByLabelText("Code"), "12345");
  expect(onSubmit).not.toHaveBeenCalled();
});
test("a corrected code is submitted again", async () => {
  const { onSubmit } = setup();
  await userEvent.type(screen.getByLabelText("Code"), "123456{Backspace}7");
  expect(onSubmit).toHaveBeenNthCalledWith(1, "123456");
  expect(onSubmit).toHaveBeenNthCalledWith(2, "123457");
});
test("the input asks the phone for a one-time code and has no maxlength", () => {
  setup();
  const input = screen.getByLabelText("Code");
  expect(input).toHaveAttribute("autocomplete", "one-time-code");
  expect(input).toHaveAttribute("inputmode", "numeric");
  expect(input).not.toHaveAttribute("maxlength");
});
test("shows the address in the text", () => {
  setup();
  expect(
    screen.getByText(
      "We hebben een code gestuurd naar noor@example.test. De code is een half uur geldig.",
    ),
  ).toBeVisible();
});
test("no Open je mail button without onOpenMail", () => {
  setup();
  expect(screen.queryByRole("button", { name: "Open je mail" })).toBeNull();
});
test("Open je mail calls onOpenMail", async () => {
  const onOpenMail = vi.fn();
  setup({ onOpenMail });
  await userEvent.click(screen.getByRole("button", { name: "Open je mail" }));
  expect(onOpenMail).toHaveBeenCalledOnce();
});
test("Stuur opnieuw and Ander e-mailadres call their handlers", async () => {
  const { onResend, onChangeEmail } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Stuur opnieuw" }));
  await userEvent.click(screen.getByRole("button", { name: "Ander e-mailadres" }));
  expect(onResend).toHaveBeenCalledOnce();
  expect(onChangeEmail).toHaveBeenCalledOnce();
});
test("buttons are disabled while pending", () => {
  setup({ pending: true, onOpenMail: vi.fn() });
  expect(screen.getAllByRole("button", { name: "Even geduld…" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  expect(screen.getByLabelText("Code")).toHaveAttribute("readonly");
});
test("shows an error and the resent message", () => {
  setup({ error: "Deze code klopt niet. Kijk nog eens in je mail." });
  expect(screen.getByRole("alert")).toHaveTextContent("Deze code klopt niet.");
});
test("shows that the code was sent again", () => {
  setup({ resent: true });
  expect(screen.getByText("We hebben de code opnieuw gestuurd.")).toBeVisible();
});
test("a seventh digit does not submit again", async () => {
  const { onSubmit } = setup();
  await userEvent.type(screen.getByLabelText("Code"), "1234567");
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("123456");
});
test("after an attempt the field is empty and the same code can be submitted again", async () => {
  const { onSubmit, rerender } = setup();
  const props = {
    email: "noor@example.test",
    onSubmit,
    onResend: vi.fn(),
    onChangeEmail: vi.fn(),
  };
  await userEvent.type(screen.getByLabelText("Code"), "123456");
  rerender(<CodeForm {...props} pending />);
  rerender(<CodeForm {...props} pending={false} error="Deze code klopt niet." />);
  expect(screen.getByLabelText("Code")).toHaveValue("");
  expect(screen.getByLabelText("Code")).toHaveFocus();
  await userEvent.paste("123456");
  expect(onSubmit).toHaveBeenCalledTimes(2);
  rerender(<CodeForm {...props} pending />);
  rerender(<CodeForm {...props} pending={false} error="Deze code klopt niet." />);
  await userEvent.type(screen.getByLabelText("Code"), "654321");
  expect(onSubmit).toHaveBeenLastCalledWith("654321");
});
test("Open je mail stays enabled while pending", () => {
  setup({ pending: true, onOpenMail: vi.fn() });
  expect(screen.getByRole("button", { name: "Open je mail" })).toBeEnabled();
});
