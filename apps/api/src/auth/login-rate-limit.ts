import {
  countLoginCodeRequests,
  lockLoginCodeRequests,
  pruneLoginCodeRequests,
  recordLoginCodeRequest,
  type Db,
} from "@padvinder/db";
import { z } from "zod";

/** Login codes one email address may ask for (the design, "Login" → "Rate limits"). */
export const LOGIN_CODE_LIMITS = { perQuarterHour: 3, perDay: 10 };

/**
 * Requests per IP address, through Better Auth's limiter. Windows are in seconds. Room for an
 * instruction evening where a room of volunteers on one Wi-Fi network logs in together.
 */
export const IP_LIMITS = {
  sendCode: { window: 300, max: 30 },
  checkCode: { window: 300, max: 60 },
};

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** At most 254 characters (RFC 5321). Better Auth checks only the form, not the length. */
const loginAddressSchema = z.email().max(254);

/**
 * Whether an address may be counted and sent a code. Checked before counting, so a malformed or
 * oversized string is never stored.
 */
export function isValidLoginAddress(email: string): boolean {
  return loginAddressSchema.safeParse(email).success;
}

/**
 * Whether this address may ask for another login code. Counts first and records the request only
 * when the answer is "ok", so refused requests do not extend the wait. A lock per address makes
 * this one step: requests that arrive at once cannot all count the same total and all pass. Old
 * rows are pruned either way. Pass a normalized, valid address.
 */
export async function checkLoginCodeRequest(
  db: Db,
  email: string,
  now: Date,
): Promise<"ok" | "limited"> {
  const since = (ms: number) => new Date(now.getTime() - ms);
  return db.transaction(async (tx) => {
    await lockLoginCodeRequests(tx, email);
    const lastQuarterHour = await countLoginCodeRequests(tx, email, since(QUARTER_HOUR_MS));
    const lastDay = await countLoginCodeRequests(tx, email, since(DAY_MS));
    if (
      lastQuarterHour >= LOGIN_CODE_LIMITS.perQuarterHour ||
      lastDay >= LOGIN_CODE_LIMITS.perDay
    ) {
      await pruneLoginCodeRequests(tx, now);
      return "limited";
    }
    await recordLoginCodeRequest(tx, email, now);
    return "ok";
  });
}
