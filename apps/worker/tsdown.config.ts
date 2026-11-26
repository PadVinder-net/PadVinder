import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  // package.json says "type": "module", so a plain .js file is ESM.
  fixedExtension: false,
  // Source maps, for readable stack traces in Sentry.
  sourcemap: true,
  // Bundle our own workspace packages (they export TypeScript source); keep node_modules external.
  deps: { alwaysBundle: [/^@padvinder\//] },
});
