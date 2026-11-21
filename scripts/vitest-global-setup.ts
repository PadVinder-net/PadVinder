import { prepareTestTemplate } from "../packages/db/src/testing";

export default async function setup(): Promise<void> {
  console.log("Preparing the test database template");
  await prepareTestTemplate();
}
