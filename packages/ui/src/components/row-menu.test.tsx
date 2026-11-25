import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RowMenu } from "./row-menu";

test("the menu opens its items and calls onSelect", async () => {
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  render(
    <RowMenu
      label="Acties voor Noord"
      items={[
        { label: "Wijzig", onSelect: onEdit },
        { label: "Zet uit", onSelect: onRemove, destructive: true },
      ]}
    />,
  );
  expect(screen.queryByRole("menuitem")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Noord" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Wijzig",
    "Zet uit",
  ]);
  await userEvent.click(screen.getByRole("menuitem", { name: "Zet uit" }));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onEdit).not.toHaveBeenCalled();
  expect(screen.queryByRole("menuitem")).toBeNull();
});

test("without items there is no button", () => {
  render(<RowMenu label="Acties voor Noord" items={[]} />);
  expect(screen.queryByRole("button")).toBeNull();
});
