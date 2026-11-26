import { isIPv4, isIPv6 } from "node:net";

/** The groups of an IPv6 address, each four hex digits, eight of them. */
function expandIPv6(input: string): string[] {
  // A dotted IPv4 tail (`::1.2.3.4`) is two groups.
  const address = input.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) =>
    [((Number(a) << 8) | Number(b)).toString(16), ((Number(c) << 8) | Number(d)).toString(16)].join(
      ":",
    ),
  );
  const [left = "", right] = address.split("::");
  const head = left === "" ? [] : left.split(":");
  const tail = right === undefined || right === "" ? [] : right.split(":");
  const zeros = right === undefined ? [] : Array<string>(8 - head.length - tail.length).fill("0");
  return [...head, ...zeros, ...tail].map((group) => group.padStart(4, "0").toLowerCase());
}

function normalize(address: string): string {
  if (isIPv4(address)) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  // One person's network usually has a whole /64 to pick addresses from.
  return `${expandIPv6(address).slice(0, 4).join(":")}::/64`;
}

/**
 * The client address for a limit per sender, taken as Better Auth takes it for the login limits
 * (`apps/api/src/auth/auth.ts`): `X-Forwarded-For` when it holds exactly one valid address (an
 * IPv6 address counts by its /64), else the socket's address, which behind Alwaysdata's proxy is
 * one bucket shared by everyone, as Better Auth's fallback is.
 */
export function clientAddress(request: {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}): string {
  const header = request.headers["x-forwarded-for"];
  if (typeof header === "string") {
    const addresses = header
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);
    const [only] = addresses;
    if (addresses.length === 1 && only !== undefined && (isIPv4(only) || isIPv6(only))) {
      return normalize(only);
    }
  }
  return request.ip;
}
