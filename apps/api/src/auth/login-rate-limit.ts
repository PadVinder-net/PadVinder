import {
  countLoginCodeRequests,
  lockLoginCodeRequests,
  pruneLoginData,
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

/** Why a request for a login code was refused: the limit per quarter hour or per day. */
export type LoginCodeLimit = "quarterHour" | "day";

/**
 * Whether this address may ask for another login code: `"ok"`, or the limit it has reached (the
 * daily one when both are). Counts first and records the request only when the answer is "ok",
 * so refused requests do not extend the wait. A lock per address makes this one step: requests
 * that arrive at once cannot all count the same total and all pass. Old login data is pruned
 * either way. Pass a normalized, valid address.
 */
export async function checkLoginCodeRequest(
  db: Db,
  email: string,
  now: Date,
): Promise<"ok" | LoginCodeLimit> {
  const since = (ms: number) => new Date(now.getTime() - ms);
  return db.transaction(async (tx) => {
    await lockLoginCodeRequests(tx, email);
    const counts = await countLoginCodeRequests(tx, email, {
      quarterHour: since(QUARTER_HOUR_MS),
      day: since(DAY_MS),
    });
    await pruneLoginData(tx, now);
    if (counts.day >= LOGIN_CODE_LIMITS.perDay) return "day";
    if (counts.quarterHour >= LOGIN_CODE_LIMITS.perQuarterHour) return "quarterHour";
    await recordLoginCodeRequest(tx, email, now);
    return "ok";
  });
}
