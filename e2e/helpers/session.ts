import type { APIResponse, BrowserContext } from "@playwright/test";
import { readLoginCode } from "./mailpit.ts";

function appOrigin(): string {
  const port = process.env.MOBILE_PORT;
  if (!port) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");
  return `http://localhost:${port}`;
}

async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(`${what} failed with ${response.status()}: ${await response.text()}`);
  }
}

/**
 * Logs in through the API, without the login screens, so the browser context holds the session
 * cookie. Then sets the name (default "Test Persoon"). For tests that are not about logging in.
 */
export async function createSession(
  context: BrowserContext,
  address: string,
  profile: { name?: string } = {},
): Promise<void> {
  const origin = appOrigin();
  // `context.request` sends no Origin; Better Auth refuses a POST with a cookie but without one.
  const headers = { origin };
  await expectOk(
    await context.request.post(`${origin}/api/auth/email-otp/send-verification-otp`, {
      headers,
      data: { email: address, type: "sign-in" },
    }),
    "Asking for a code",
  );
  const otp = await readLoginCode(address);
  await expectOk(
    await context.request.post(`${origin}/api/auth/sign-in/email-otp`, {
      headers,
      data: { email: address, otp },
    }),
    "Signing in",
  );
  await expectOk(
    await context.request.patch(`${origin}/api/me`, {
      headers,
      data: { name: profile.name ?? "Test Persoon" },
    }),
    "Setting the name",
  );
}
