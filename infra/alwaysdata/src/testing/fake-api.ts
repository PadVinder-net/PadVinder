import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Resource, ResourceKind } from "../api.ts";

const kinds: ResourceKind[] = ["site", "database", "database/user", "service"];

export type FakeAlwaysdata = {
  baseUrl: string;
  resources: Map<ResourceKind, Resource[]>;
  requests: { method: string; path: string; body: unknown }[];
  /** The next request answers with this status; calls queue up. */
  failNext(status: number): void;
  /** The next request is applied, then answers with this status. */
  failNextAfterApply(status: number): void;
  close(): Promise<void>;
};

/** In-memory stand-in for the Alwaysdata API. Requires Basic auth; POST answers 201 with no body. */
export async function startFakeAlwaysdata(): Promise<FakeAlwaysdata> {
  const resources = new Map<ResourceKind, Resource[]>(kinds.map((kind) => [kind, []]));
  const requests: FakeAlwaysdata["requests"] = [];
  const failures: { status: number; afterApply: boolean }[] = [];
  let nextId = 1;

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    requests.push({ method, path, body: raw === "" ? undefined : JSON.parse(raw) });

    const failure = failures.shift();
    const send = (status: number, body?: unknown) => {
      if (failure?.afterApply) {
        status = failure.status;
        body = { detail: "forced failure" };
      }
      res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    if (failure && !failure.afterApply) return send(failure.status, { detail: "forced failure" });
    if (!req.headers.authorization?.startsWith("Basic ")) return send(401, { detail: "no auth" });

    const body = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
    const restart = /^\/v1\/service\/(\d+)\/restart\/$/.exec(path);
    if (restart && method === "POST") return send(204);

    const match = /^\/v1\/(site|database\/user|database|service)\/(?:(\d+)\/)?$/.exec(path);
    if (!match) return send(404, { detail: "not found" });
    const items = resources.get(match[1] as ResourceKind) ?? [];
    const id = match[2] === undefined ? undefined : Number(match[2]);

    if (id === undefined && method === "GET") return send(200, items);
    if (id === undefined && method === "POST") {
      items.push({ ...body, id: nextId++ });
      return send(201);
    }
    const item = items.find((r) => r.id === id);
    if (!item) return send(404, { detail: "not found" });
    if (method === "GET") return send(200, item);
    if (method === "PATCH") {
      Object.assign(item, body, { id });
      return send(204);
    }
    return send(405);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    resources,
    requests,
    failNext: (status) => void failures.push({ status, afterApply: false }),
    failNextAfterApply: (status) => void failures.push({ status, afterApply: true }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
