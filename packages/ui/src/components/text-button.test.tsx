import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TextButton } from "./text-button";

test("is a button that does not submit a form", async () => {
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
  const onClick = vi.fn();
  render(
    <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
      <TextButton onClick={onClick}>Log uit</TextButton>
    </form>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Log uit" }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("has no underline", () => {
  render(<TextButton>Log uit</TextButton>);
  expect(screen.getByRole("button", { name: "Log uit" })).not.toHaveClass("underline");
});
