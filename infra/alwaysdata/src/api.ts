import { z } from "zod";
import { redact } from "./redact.ts";

export type Resource = { id: number; [field: string]: unknown };
export type ResourceKind = "site" | "database" | "database/user" | "service";

export interface AlwaysdataApi {
  list(kind: ResourceKind): Promise<Resource[]>;
  /** Creates a resource and returns it, found again in the list by `identity`. */
  create(
    kind: ResourceKind,
    body: Record<string, unknown>,
    identity: { field: string; value: string },
  ): Promise<Resource>;
  update(kind: ResourceKind, id: number, patch: Record<string, unknown>): Promise<void>;
  restartService(id: number): Promise<void>;
}

export class AlwaysdataError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} failed with ${status}${body === "" ? "" : `: ${body}`}`);
    this.name = "AlwaysdataError";
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

export type AlwaysdataApiOptions = {
  apiKey: string;
  account: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Minimum time between requests; the default stays under 50 requests per minute. */
  minIntervalMs?: number;
  /** Base delay for retries; doubles with each try. */
  retryDelayMs?: number;
  /** How long one request (until its body is read) may take. Default 30 s. */
  requestTimeoutMs?: number;
};

const maxTries = 3;
const resourceListSchema = z.array(z.looseObject({ id: z.number() }));

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export function createAlwaysdataApi(options: AlwaysdataApiOptions): AlwaysdataApi {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.alwaysdata.com").replace(/\/+$/, "");
  const minIntervalMs = options.minIntervalMs ?? 1300;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const authorization = `Basic ${Buffer.from(`${options.apiKey} account=${options.account}:`).toString("base64")}`;

  // Requests run one at a time, at least minIntervalMs apart.
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      await sleep(lastStart + minIntervalMs - Date.now());
      lastStart = Date.now();
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const secrets = [options.apiKey, authorization.slice("Basic ".length)];

  /**
   * `beforeRetry` runs before a retry of a non-idempotent request; when it returns true the
   * earlier attempt is taken to have succeeded and no retry is sent.
   */
  async function request(
    method: string,
    path: string,
    body?: unknown,
    beforeRetry?: () => Promise<boolean>,
  ): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = {
        Authorization: authorization,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      let response: Response;
      let text: string;
      try {
        response = await schedule(() =>
          doFetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            // Covers reading the body too: a server that never answers cannot hang a deploy.
            signal: AbortSignal.timeout(requestTimeoutMs),
          }),
        );
        text = await response.text();
      } catch (cause) {
        // Only a GET is safe to resend when we do not know whether the server got the request.
        if (method === "GET" && attempt < maxTries) {
          await sleep(retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        const detail = timedOut
          ? `no answer within ${requestTimeoutMs} ms`
          : cause instanceof Error
            ? cause.message
            : String(cause);
        throw new AlwaysdataError(
          method,
          path,
          0,
          redact(`${timedOut ? "timeout" : "network error"}: ${detail}`, secrets),
        );
      }
      if (response.ok) return text;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxTries) {
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        if (beforeRetry && (await beforeRetry())) return "";
        continue;
      }
      throw new AlwaysdataError(method, path, response.status, redact(text, secrets).slice(0, 500));
    }
  }

  const collectionPath = (kind: ResourceKind) => `/v1/${kind}/`;

  async function list(kind: ResourceKind): Promise<Resource[]> {
    const text = await request("GET", collectionPath(kind));
    return resourceListSchema.parse(JSON.parse(text)) as Resource[];
  }

  return {
    list,
    async create(kind, body, identity) {
      const findMatches = async () =>
        (await list(kind)).filter((r) => r[identity.field] === identity.value);
      // A 5xx may come after the server stored the resource: look before every retry.
      await request(
        "POST",
        collectionPath(kind),
        body,
        async () => (await findMatches()).length > 0,
      );
      const matches = await findMatches();
      const [created, ...duplicates] = matches;
      if (!created) {
        throw new Error(
          `Created ${kind} with ${identity.field} "${identity.value}" but did not find it afterwards`,
        );
      }
      if (duplicates.length > 0) {
        throw new Error(
          `Found ${matches.length} ${kind} resources with ${identity.field} "${identity.value}"; expected one`,
        );
      }
      return created;
    },
    async update(kind, id, patch) {
      await request("PATCH", `/v1/${kind}/${id}/`, patch);
    },
    async restartService(id) {
      await request("POST", `/v1/service/${id}/restart/`);
    },
  };
}
