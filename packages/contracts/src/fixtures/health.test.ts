import { expect, test } from "vitest";
import { healthResponseSchema } from "../health";
import {
  databaseUnreachableFixture,
  detailsHiddenFixture,
  healthyFixture,
  workerStaleFixture,
} from "./health";

test.each([healthyFixture, workerStaleFixture, databaseUnreachableFixture, detailsHiddenFixture])(
  "fixture matches the schema",
  (f) => expect(healthResponseSchema.parse(f)).toEqual(f),
);
test("databaseUnreachableFixture has no versions", () => {
  expect(databaseUnreachableFixture.database).toMatchObject({
    reachable: false,
    postgresVersion: null,
    postgisVersion: null,
    latestMigration: null,
  });
});
