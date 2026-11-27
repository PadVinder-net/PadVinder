import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PasskeyHidden } from "./passkey-hidden";

test("the eye button has the aria-label Toon met je toegangssleutel and calls onReveal", async () => {
  const onReveal = vi.fn();
  render(<PasskeyHidden onReveal={onReveal} />);
  await userEvent.click(screen.getByRole("button", { name: "Toon met je toegangssleutel" }));
  expect(onReveal).toHaveBeenCalledOnce();
});
