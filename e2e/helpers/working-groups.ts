import { runAdmin } from "./admin.ts";
import { newAddress, randomWord } from "./mailpit.ts";

export type TestWorkingGroup = {
  id: string;
  name: string;
  organizationId: string;
  /** The organization's admin, a fresh address that has never logged in. */
  adminAddress: string;
};

/**
 * A new organization with one working group, named with random letters ("Groep qwhzkepa"), made
 * with the admin tool. The organization gets a fresh address as its admin. The picker lists every
 * group in the workspace's dev database, where groups from earlier runs and parallel workers pile
 * up (they are never removed), so a test finds its own group by filtering on its name.
 */
export function createWorkingGroup(): TestWorkingGroup {
  const word = randomWord();
  const adminAddress = newAddress("beheerder");
  const output = runAdmin(
    "create-organization",
    "--name",
    `Organisatie ${word}`,
    "--admin-email",
    adminAddress,
  );
  // The first line is the ID; a second says the tool made the admin's account.
  const organizationId = output.split("\n")[0]!.trim();
  return { organizationId, adminAddress, ...addWorkingGroup(organizationId) };
}

/** Another working group in an organization made by `createWorkingGroup`. */
export function addWorkingGroup(organizationId: string): { id: string; name: string } {
  const name = `Groep ${randomWord()}`;
  const city = `Plaats ${randomWord()}`;
  const id = runAdmin(
    "create-working-group",
    "--organization",
    organizationId,
    "--name",
    name,
    "--city",
    city,
  );
  return { id, name };
}

/** Makes `address` coordinator of the group; creates the account when there is none. */
export function makeCoordinator(address: string, workingGroupId: string): void {
  runAdmin("grant-coordinator", "--email", address, "--working-group", workingGroupId);
}

/**
 * Makes `address` a volunteer of the group without a request: the admin tool makes them
 * coordinator, and taking that away keeps them as a volunteer.
 */
export function makeVolunteer(address: string, workingGroupId: string): void {
  makeCoordinator(address, workingGroupId);
  runAdmin("revoke-coordinator", "--email", address, "--working-group", workingGroupId);
}
