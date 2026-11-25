import { runAdmin } from "./admin.ts";
import { newAddress, randomWord } from "./mailpit.ts";

export type TestWorkingGroup = {
  id: string;
  name: string;
  organizationId: string;
  /** The organization's admin, a fresh address that has never logged in. */
  adminAddress: string;
  /** The group's first coordinator, a fresh address that has never logged in. */
  coordinatorAddress: string;
};

/**
 * A new organization with one working group, named with random letters ("Groep qwhzkepa"), made
 * with the admin tool. The organization gets a fresh address as its admin, and the group one as its
 * first coordinator. The picker lists every
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

/**
 * Another working group in an organization made by `createWorkingGroup`, with a fresh address as
 * its first coordinator (every active working group has one).
 */
export function addWorkingGroup(organizationId: string): {
  id: string;
  name: string;
  coordinatorAddress: string;
} {
  const name = `Groep ${randomWord()}`;
  const city = `Plaats ${randomWord()}`;
  const coordinatorAddress = newAddress("coordinator");
  const output = runAdmin(
    "create-working-group",
    "--organization",
    organizationId,
    "--name",
    name,
    "--city",
    city,
    "--coordinator-email",
    coordinatorAddress,
  );
  // The first line is the ID; a second says the tool made the coordinator's account.
  const id = output.split("\n")[0]!.trim();
  return { id, name, coordinatorAddress };
}

/** Makes `address` coordinator of the group; creates the account when there is none. */
export function makeCoordinator(address: string, workingGroupId: string): void {
  runAdmin("grant-coordinator", "--email", address, "--working-group", workingGroupId);
}

/**
 * Makes `address` a volunteer of the group without a request: the admin tool makes them
 * coordinator, and taking that away keeps them as a volunteer. The group's first coordinator
 * stays, so the revoke is allowed.
 */
export function makeVolunteer(address: string, workingGroupId: string): void {
  makeCoordinator(address, workingGroupId);
  runAdmin("revoke-coordinator", "--email", address, "--working-group", workingGroupId);
}
