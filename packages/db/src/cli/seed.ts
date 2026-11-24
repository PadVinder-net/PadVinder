import { createDb } from "../client";
import { assertLocalSeed, seed } from "../seed";

try {
  assertLocalSeed(process.env.PUBLIC_ORIGIN);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const { db, pool } = createDb(databaseUrl);
try {
  await seed(db);
  console.log("Seed is done.");
} finally {
  await pool.end();
}
