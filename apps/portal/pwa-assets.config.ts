import { defineConfig } from "@vite-pwa/assets-generator/config";

// Only used by `pnpm icons:generate`: the portal is not a PWA, so these files are committed.
// Full-bleed, as in the mobile app: iOS rounds the Apple touch icon itself.
export default defineConfig({
  preset: {
    transparent: { sizes: [], favicons: [[48, "favicon.ico"]] },
    maskable: { sizes: [] },
    apple: { sizes: [180], padding: 0, resizeOptions: { background: "#c8102e" } },
  },
  // A symlink to the one source icon in packages/ui/assets.
  images: ["public/favicon.svg"],
});
