import type { ManifestOptions } from "vite-plugin-pwa";

export const manifest: Partial<ManifestOptions> = {
  // Fixed identity of the installed app, independent of start_url.
  id: "/app/",
  name: "PadVinder",
  short_name: "PadVinder",
  lang: "nl",
  start_url: "/app/",
  scope: "/app/",
  display: "standalone",
  // The icon sets the red; the rest of the visual identity (colors, typography) is still open.
  theme_color: "#c8102e",
  background_color: "#ffffff",
};
