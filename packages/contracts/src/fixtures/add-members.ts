import type { AddMembersResponse } from "../add-members";

/** One result of each outcome. */
export const addMembersResultFixture: AddMembersResponse = {
  results: [
    { email: "nieuw@example.test", outcome: "added" },
    { email: "aanmelder@example.test", outcome: "approved" },
    { email: "bekend@example.test", outcome: "invited" },
    { email: "lid@example.test", outcome: "already_member" },
    { email: "jan@", outcome: "invalid" },
  ],
};
