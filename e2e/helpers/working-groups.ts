import { runAdmin } from "./admin.ts";
import { randomWord } from "./mailpit.ts";

export type TestWorkingGroup = { id: string; name: string; organizationId: string };

/**
 * A new organization with one working group, named with random letters ("Groep qwhzkepa"), made
 * with the admin tool. The picker lists the groups of every test and workspace, so a test finds
 * its own group by filtering on its name.
 */
export function createWorkingGroup(): TestWorkingGroup {
  const word = randomWord();
  const organizationId = runAdmin("create-organization", "--name", `Organisatie ${word}`);
  return { organizationId, ...addWorkingGroup(organizationId) };
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
