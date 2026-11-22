import { requestsForReviewFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MembershipRequestDetail } from "./membership-request-detail";

const [noor, sem] = requestsForReviewFixture;

function setup(request = noor!, extra: { pending?: boolean; error?: string } = {}) {
  const handlers = { onApprove: vi.fn(), onReject: vi.fn() };
  render(
    <MembershipRequestDetail
      request={request}
      pending={extra.pending ?? false}
      error={extra.error}
      {...handlers}
    />,
  );
  return handlers;
}

test("shows the contact details with links", () => {
  setup();
  expect(screen.getByRole("heading", { name: "Noor Jansen" })).toBeVisible();
  expect(screen.getByRole("link", { name: "noor@example.test" })).toHaveAttribute(
    "href",
    "mailto:noor@example.test",
  );
  expect(screen.getByRole("link", { name: "06 12345678" })).toHaveAttribute(
    "href",
    "tel:0612345678",
  );
  expect(screen.getByText("Aangemeld op 9 januari 2027")).toBeVisible();
  expect(screen.getByText("Werkgroep")).toBeVisible();
  expect(screen.getByText("Noord")).toBeVisible();
});

test("a request without a phone number says so", () => {
  setup(sem!);
  expect(screen.getByText("Geen telefoonnummer")).toBeVisible();
  expect(screen.queryByRole("link", { name: /^06/ })).toBeNull();
});

test("a deleted applicant shows no contact rows", () => {
  setup({ ...noor!, applicant: { id: noor!.applicant.id, name: "Verwijderd account" } });
  expect(screen.queryByText("E-mailadres")).toBeNull();
  expect(screen.queryByText("Telefoonnummer")).toBeNull();
  expect(screen.queryByText("Geen telefoonnummer")).toBeNull();
});

test("approving calls onApprove", async () => {
  const { onApprove } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Keur goed" }));
  expect(onApprove).toHaveBeenCalledOnce();
});

test("rejecting asks first and calls onReject once", async () => {
  const { onReject } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Wijs af" }));
  const dialog = screen.getByRole("alertdialog", { name: "Aanmelding afwijzen?" });
  expect(dialog).toHaveTextContent("Noor Jansen krijgt hierover een mail.");
  expect(onReject).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Wijs af" }));
  expect(onReject).toHaveBeenCalledOnce();
});

test("Annuleer does not reject", async () => {
  const { onReject } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Wijs af" }));
  await userEvent.click(screen.getByRole("button", { name: "Annuleer" }));
  expect(onReject).not.toHaveBeenCalled();
});

test("a decided request shows no buttons and the handled text", () => {
  // The API sends a decided request without the applicant's contact details.
  setup({
    ...noor!,
    status: "approved",
    decidedAt: "2027-01-12T09:30:00.000+01:00",
    applicant: { id: noor!.applicant.id, name: noor!.applicant.name },
  });
  expect(screen.getByText("Deze aanmelding is al behandeld.")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText("E-mailadres")).toBeNull();
});

test("shows an error", () => {
  setup(noor!, { error: "Het lukt nu niet." });
  expect(screen.getByRole("alert")).toHaveTextContent("Het lukt nu niet.");
});

test("a nameless applicant reads well in the dialog", async () => {
  setup({ ...noor!, applicant: { ...noor!.applicant, name: "" } });
  expect(screen.getByRole("heading", { name: "Naam niet ingevuld" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Wijs af" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Deze persoon krijgt hierover een mail.",
  );
});

test("an error that arrives while the dialog is open shows inside it", async () => {
  const props = { request: noor!, onApprove: vi.fn(), onReject: vi.fn(), pending: false };
  const { rerender } = render(<MembershipRequestDetail {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Wijs af" }));
  rerender(<MembershipRequestDetail {...props} error="Het lukt nu niet." />);
  expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(
    "Het lukt nu niet.",
  );
});
