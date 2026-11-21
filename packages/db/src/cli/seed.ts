import { createDb } from "../client";
import { seed } from "../seed";

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
