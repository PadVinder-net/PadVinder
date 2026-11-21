// @vitest-environment node
import type { ConfigEnv, UserConfig } from "vite";
import { afterEach, expect, test, vi } from "vitest";
import viteConfig from "./vite.config";

const buildEnv: ConfigEnv = { command: "build", mode: "production" };
const resolve = () => (viteConfig as (env: ConfigEnv) => UserConfig)(buildEnv);

const devEnv: ConfigEnv = { command: "serve", mode: "development" };
const resolveDev = () => (viteConfig as (env: ConfigEnv) => UserConfig)(devEnv);

afterEach(() => vi.unstubAllEnvs());

test("a build needs no PORTAL_PORT", () => {
  vi.stubEnv("PORTAL_PORT", "");
  expect(resolve().base).toBe("/");
});

test("the dev server still requires PORTAL_PORT", () => {
  vi.stubEnv("PORTAL_PORT", "");
  expect(resolveDev).toThrow(/PORTAL_PORT is missing/);
});

test("the dev server uses PORTAL_PORT", () => {
  vi.stubEnv("PORTAL_PORT", "4102");
  expect(resolveDev().server).toMatchObject({ port: 4102, strictPort: true });
});

test("fails the dev server on a PORTAL_PORT that is not a number", () => {
  vi.stubEnv("PORTAL_PORT", "abc");
  expect(resolveDev).toThrow(/PORTAL_PORT/);
});
