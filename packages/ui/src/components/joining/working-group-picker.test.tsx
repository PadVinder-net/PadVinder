import { workingGroupsFixture } from "@padvinder/contracts/fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { WorkingGroupPicker } from "./working-group-picker";

function setup(props: Partial<React.ComponentProps<typeof WorkingGroupPicker>> = {}) {
  const onJoin = vi.fn();
  render(
    <WorkingGroupPicker
      workingGroups={workingGroupsFixture}
      onJoin={onJoin}
      pending={false}
      {...props}
    />,
  );
  return onJoin;
}
const filter = () => screen.getByLabelText("Zoek op werkgroep, organisatie of plaats");
const join = () => screen.getByRole("button", { name: "Meld je aan" });

test("shows the heading and a row per group with organization and city", () => {
  setup();
  expect(screen.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  expect(screen.getAllByRole("radio")).toHaveLength(5);
  expect(screen.getByText("Paddentrek Voorbeeldstad · Poelwijk")).toBeVisible();
});
test("typing filters the list", async () => {
  setup();
  await userEvent.type(filter(), "poelwijk");
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.getByRole("radio", { name: /Salamanderbrug/ })).toBeVisible();
});
test("the button is disabled until a row is chosen, then calls onJoin with its id", async () => {
  const onJoin = setup();
  expect(join()).toBeDisabled();
  await userEvent.click(screen.getByRole("radio", { name: /Noord/ }));
  expect(screen.getByRole("radio", { name: /Noord/ })).toBeChecked();
  await userEvent.click(join());
  expect(onJoin).toHaveBeenCalledExactlyOnceWith(workingGroupsFixture[2]!.id);
});
test("a chosen row that the filter hides is no longer chosen", async () => {
  const onJoin = setup();
  await userEvent.click(screen.getByRole("radio", { name: /Noord/ }));
  await userEvent.type(filter(), "dorp");
  expect(join()).toBeDisabled();
  await userEvent.clear(filter());
  expect(join()).toBeDisabled();
  expect(onJoin).not.toHaveBeenCalled();
});
test("shows the rejection notice", () => {
  setup({ rejectedFrom: "Noord" });
  expect(
    screen.getByText(
      "Je aanmelding bij Noord is niet goedgekeurd. Je kunt een andere werkgroep kiezen.",
    ),
  ).toBeVisible();
});
test("shows the empty text", async () => {
  setup();
  await userEvent.type(filter(), "xyz");
  expect(screen.getByText("Geen werkgroep gevonden.")).toBeVisible();
});
test("the button is disabled while pending and shows an error", async () => {
  setup({ pending: true, error: "Het lukt nu niet." });
  expect(screen.getByRole("button", { name: "Even geduld…" })).toBeDisabled();
  expect(screen.getByText("Het lukt nu niet.")).toBeVisible();
});
