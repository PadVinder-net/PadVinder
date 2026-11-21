import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  extensionsFilters: ["postgis"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
