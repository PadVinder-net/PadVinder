import { countLoginCodeRequests, recordLoginCodeRequest, type Db } from "@padvinder/db";

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

/**
 * Whether this address may ask for another login code. Counts first and records the request only
 * when the answer is "ok", so refused requests do not extend the wait. Pass a normalized address.
 */
export async function checkLoginCodeRequest(
  db: Db,
  email: string,
  now: Date,
): Promise<"ok" | "limited"> {
  const since = (ms: number) => new Date(now.getTime() - ms);
  const [lastQuarterHour, lastDay] = await Promise.all([
    countLoginCodeRequests(db, email, since(QUARTER_HOUR_MS)),
    countLoginCodeRequests(db, email, since(DAY_MS)),
  ]);
  if (lastQuarterHour >= LOGIN_CODE_LIMITS.perQuarterHour || lastDay >= LOGIN_CODE_LIMITS.perDay) {
    return "limited";
  }
  await recordLoginCodeRequest(db, email, now);
  return "ok";
}
