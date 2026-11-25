import { addMembersResultFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AddMembersResults } from "./add-members-results";

test("the results show one line per address and call onClose", async () => {
  const onClose = vi.fn();
  render(<AddMembersResults results={addMembersResultFixture.results} onClose={onClose} />);
  const items = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "nieuw@example.test is toegevoegd.",
    "aanmelder@example.test is toegelaten.",
    "bekend@example.test heeft al een account en krijgt een mail.",
    "lid@example.test is al lid.",
    "'jan@' is geen geldig e-mailadres.",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Sluit" }));
  expect(onClose).toHaveBeenCalledOnce();
});
