// @vitest-environment node
import type { ConfigEnv, UserConfig } from "vite";
import { afterEach, expect, test, vi } from "vitest";
import { manifest } from "./pwa-manifest";
import pwaAssetsConfig from "./pwa-assets.config";
import viteConfig from "./vite.config";

const buildEnv: ConfigEnv = { command: "build", mode: "production" };
const resolve = () => (viteConfig as (env: ConfigEnv) => UserConfig)(buildEnv);

afterEach(() => vi.unstubAllEnvs());

const devEnv: ConfigEnv = { command: "serve", mode: "development" };
const resolveDev = () => (viteConfig as (env: ConfigEnv) => UserConfig)(devEnv);

test("uses a valid PADVINDER_APP_VERSION", () => {
  vi.stubEnv("PADVINDER_APP_VERSION", "2027.3.1");
  expect(resolve().define?.__APP_VERSION__).toBe(JSON.stringify("2027.3.1"));
});

test("an empty PADVINDER_APP_VERSION counts as unset and defaults to 2027.0.0", () => {
  vi.stubEnv("PADVINDER_APP_VERSION", "");
  expect(resolve().define?.__APP_VERSION__).toBe(JSON.stringify("2027.0.0"));
});

test("ignores a stray APP_VERSION from the environment", () => {
  // Conductor sets its own APP_VERSION in its shells.
  vi.stubEnv("PADVINDER_APP_VERSION", "");
  vi.stubEnv("APP_VERSION", "0.98.0");
  expect(resolve().define?.__APP_VERSION__).toBe(JSON.stringify("2027.0.0"));
  expect(resolveDev().define?.__APP_VERSION__).toBe(JSON.stringify("2027.0.0"));
});

const remedy =
  /PADVINDER_APP_VERSION "2027\.1\.0\+42" is not a CalVer version like 2027\.1\.0 \(YYYY\.N\.P\)\. Set it to YYYY\.N\.P or leave it unset to use 2027\.0\.0\./;

test("fails the build on a PADVINDER_APP_VERSION that is not CalVer", () => {
  // A build number appended to the version would silently disable the version gate.
  vi.stubEnv("PADVINDER_APP_VERSION", "2027.1.0+42");
  expect(resolve).toThrow(remedy);
});

test("fails the dev server on a PADVINDER_APP_VERSION that is not CalVer", () => {
  vi.stubEnv("PADVINDER_APP_VERSION", "2027.1.0+42");
  expect(resolveDev).toThrow(remedy);
});

test("fails the dev server on a MOBILE_PORT that is not a number", () => {
  vi.stubEnv("MOBILE_PORT", "abc");
  expect(resolveDev).toThrow(/MOBILE_PORT/);
});

test("a build needs no MOBILE_PORT", () => {
  vi.stubEnv("MOBILE_PORT", "");
  expect(resolve().base).toBe("/app/");
});

test("the dev server still requires MOBILE_PORT", () => {
  vi.stubEnv("MOBILE_PORT", "");
  expect(resolveDev).toThrow(/MOBILE_PORT is missing/);
});

test("the manifest uses the brand theme color", () => {
  expect(manifest).toMatchObject({ theme_color: "#c8102e", background_color: "#ffffff" });
});

test("the maskable and Apple touch icons are full-bleed in the brand color", () => {
  expect(pwaAssetsConfig.preset).toMatchObject({
    maskable: { padding: 0, resizeOptions: { background: "#c8102e" } },
    apple: { padding: 0, resizeOptions: { background: "#c8102e" } },
  });
});
