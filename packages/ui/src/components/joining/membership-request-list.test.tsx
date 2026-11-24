import { requestsForReviewFixture } from "@padvinder/contracts/fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MembershipRequestList } from "./membership-request-list";

const [noor, sem, fleur] = requestsForReviewFixture;
const north = noor!.workingGroup;
const southEast = fleur!.workingGroup;

test("one group shows no subheading; two groups show two", () => {
  const { unmount } = render(
    <MembershipRequestList
      groups={[{ workingGroup: north, requests: [noor!, sem!] }]}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByRole("heading", { name: "Aanmeldingen" })).toBeVisible();
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  unmount();
  render(
    <MembershipRequestList
      groups={[
        { workingGroup: north, requests: [noor!, sem!] },
        { workingGroup: southEast, requests: [fleur!] },
      ]}
      onOpen={() => {}}
    />,
  );
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Noord",
    "Zuid-Oost",
  ]);
});

test("rows show the name and the date, and open the request", async () => {
  const onOpen = vi.fn();
  render(
    <MembershipRequestList groups={[{ workingGroup: north, requests: [noor!] }]} onOpen={onOpen} />,
  );
  const row = screen.getByRole("button", { name: /Noor Jansen/ });
  expect(row).toHaveTextContent("Aangemeld op 9 januari 2027");
  await userEvent.click(row);
  expect(onOpen).toHaveBeenCalledWith(noor!.id);
});

test("no requests at all says so", () => {
  render(<MembershipRequestList groups={[]} onOpen={() => {}} />);
  expect(screen.getByText("Er zijn geen open aanmeldingen.")).toBeVisible();
});
