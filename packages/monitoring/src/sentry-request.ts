import type { ClientRequest, IncomingHttpHeaders, request } from "node:http";
import type { NodeOptions } from "@sentry/node";

/**
 * The address family of every request the API and the worker send to Sentry: IPv4. On 27 November
 * 2026 the Systeemstatus connection test showed that Google's front end before Sentry's ingest
 * refuses the Alwaysdata service machines' IPv6 address with a 403 HTML page, while it takes their
 * IPv4 address (the SSH host is not refused). The services prefer IPv6, so every event, browser
 * envelope and problem report was refused. Only Sentry's traffic is forced: the database and SMTP
 * keep Node's default.
 */
export const SENTRY_ADDRESS_FAMILY = 4;

/** How much of an answer's body is read at most: enough for a title or the start of an error page. */
const MAX_BODY_BYTES = 64 * 1024;

type RequestFunction = typeof request;

/**
 * Node's own `request` of `node:http` or `node:https`, by protocol. Taken with
 * `getBuiltinModule` when it is needed, not imported at the top: the services load this package
 * before Sentry starts.
 */
function nativeRequest(protocol: string | null | undefined): RequestFunction {
  return protocol === "http:"
    ? process.getBuiltinModule("node:http").request
    : process.getBuiltinModule("node:https").request;
}

/** A short, non-personal name for why a request got no answer: its code, or the error's name. */
export function requestErrorReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

export type SentryPostResult =
  | {
      status: number;
      headers: IncomingHttpHeaders;
      /** At most the first 64 KiB of the answer, as UTF-8. */
      body: string;
    }
  | {
      /** The network error's code (`ECONNREFUSED`, `ENOTFOUND`, …) or `TimeoutError`. */
      error: string;
    };

/**
 * Posts an envelope to Sentry over one address family only, with `Content-Type:
 * application/x-sentry-envelope` and no other header of ours. The timeout covers the connection
 * and the answer together. Never throws.
 */
export function postToSentry(
  url: URL,
  body: string | Uint8Array,
  options: { family: 4 | 6; timeoutMs: number },
): Promise<SentryPostResult> {
  return new Promise<SentryPostResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (result: SentryPostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: unknown) => settle({ error: requestErrorReason(error) });

    let outgoing: ClientRequest;
    try {
      outgoing = nativeRequest(url.protocol)(
        url,
        {
          method: "POST",
          family: options.family,
          headers: {
            "Content-Type": "application/x-sentry-envelope",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let length = 0;
          const finish = () => {
            settle({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
            response.destroy();
          };
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            length += chunk.length;
            if (length >= MAX_BODY_BYTES) finish();
          });
          response.on("end", finish);
          response.on("error", finish);
        },
      );
    } catch (error) {
      // Node checks some options (the family, for one) inside request() and throws at once.
      fail(error);
      return;
    }
    timer = setTimeout(() => {
      settle({ error: "TimeoutError" });
      outgoing.destroy();
    }, options.timeoutMs);
    outgoing.on("error", fail);
    outgoing.end(body);
  });
}

type HttpModule = NonNullable<NonNullable<NodeOptions["transportOptions"]>["httpModule"]>;

/**
 * The `httpModule` of the server SDK's transport: Node's own `http` or `https` (by the request's
 * protocol), with every request over `SENTRY_ADDRESS_FAMILY`. The transport's keep-alive agent
 * still applies; Node's agent keeps its sockets per family.
 */
export const sentryHttpModule: HttpModule = {
  request(options, callback) {
    if (typeof options === "string" || options instanceof URL) {
      const url = new URL(options);
      return nativeRequest(url.protocol)(url, { family: SENTRY_ADDRESS_FAMILY }, callback);
    }
    return nativeRequest(options.protocol)({ ...options, family: SENTRY_ADDRESS_FAMILY }, callback);
  },
};
