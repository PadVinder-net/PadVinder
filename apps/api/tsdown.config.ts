import { defineConfig } from "tsdown";

export default defineConfig({
  // main.js is the API; migrate.js applies the migrations of a release before it starts.
  entry: ["src/main.ts", "src/migrate.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  // package.json says "type": "module", so a plain .js file is ESM.
  fixedExtension: false,
  // Bundle our own workspace packages (they export TypeScript source); keep node_modules external.
  deps: { alwaysBundle: [/^@padvinder\//] },
});
