import type { BrowserContext } from "@playwright/test";
import pg from "pg";
import { loadRootEnv } from "../../scripts/load-env.ts";

const SESSION_COOKIE = "padvinder.session_token";

/**
 * Sets `passkey_verified_at` on the context's session in the dev database (`DATABASE_URL`, as the
 * dev server uses it), so an admin test acts as an admin without the passkey modal. A test helper
 * only: nothing in the release can do this. `at` is how long ago the confirmation happened
 * (default: now). Tests about passkeys use the real flow with a virtual authenticator instead.
 */
export async function confirmSession(
  context: BrowserContext,
  { minutesAgo = 0 }: { minutesAgo?: number } = {},
): Promise<void> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error("The context holds no session cookie.");
  const token = decodeURIComponent(cookie.value).split(".")[0];
  if (!token) throw new Error("The session cookie has no token.");

  loadRootEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is not set. Run scripts/setup-workspace.sh.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "update sessions set passkey_verified_at = now() - make_interval(mins => $2::int) where token = $1",
      [token, minutesAgo],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Confirming the session updated ${result.rowCount} rows, not 1.`);
    }
  } finally {
    await client.end();
  }
}
