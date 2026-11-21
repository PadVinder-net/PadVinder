import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// The brand color of the icon tile (packages/ui/assets/icon.svg).
const BRAND_RED = "#c8102e";

// Maskable and Apple touch icons are full-bleed: no padding, and the brand color behind the
// rounded corners, so the corners disappear into the same red. The default preset pads with white.
const fullBleed = { padding: 0, resizeOptions: { background: BRAND_RED } };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...fullBleed },
    apple: { ...minimal2023Preset.apple, ...fullBleed },
  },
  // A symlink to the one source icon in packages/ui/assets.
  images: ["public/icon.svg"],
});
