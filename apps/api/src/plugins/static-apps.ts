import { extname } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type StaticAppsOptions = {
  mobileDir?: string | undefined;
  portalDir?: string | undefined;
};

const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATED_FILES = new Set(["sw.js", "index.html", "manifest.webmanifest"]);

/** Hashed build output is immutable; the files that name it must be fetched fresh. */
function setCacheHeaders(reply: FastifyReply, path: string) {
  const relative = path.split(/[\\/]/);
  const name = relative.at(-1) ?? "";
  if (REVALIDATED_FILES.has(name)) void reply.header("Cache-Control", NO_CACHE);
  else if (relative.at(-2) === "assets") void reply.header("Cache-Control", IMMUTABLE);
}

function wantsHtml(request: FastifyRequest): boolean {
  return (request.headers.accept ?? "").includes("text/html");
}

/**
 * Serves the mobile build under `/app/` and the portal build under `/`, for the directories
 * that are set. `/api/*` is never served from here.
 *
 * One not-found handler at the root decides: an unknown path without a file extension, asked
 * by a browser navigation (GET/HEAD, `Accept: text/html`), gets the index of the app it is
 * under, so client-side routes survive a reload. Everything else is a 404, and an unknown
 * `/api/*` path is always the API's JSON 404.
 */
export async function registerStaticApps(
  app: FastifyInstance,
  options: StaticAppsOptions,
): Promise<void> {
  const { mobileDir, portalDir } = options;
  const common = { dotfiles: "ignore", index: "index.html", setHeaders: setCacheHeaders } as const;

  if (mobileDir) {
    app.get("/app", (request, reply) => {
      const queryStart = request.url.indexOf("?");
      const query = queryStart === -1 ? "" : request.url.slice(queryStart);
      return reply.redirect(`/app/${query}`, 308);
    });
    await app.register(fastifyStatic, { ...common, root: mobileDir, prefix: "/app/" });
  }
  if (portalDir) {
    await app.register(fastifyStatic, {
      ...common,
      root: portalDir,
      prefix: "/",
      decorateReply: !mobileDir,
    });
  }

  const sendIndex = (reply: FastifyReply, dir: string) => {
    void reply.header("Cache-Control", NO_CACHE);
    return reply.sendFile("index.html", dir);
  };

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const isApi = path === "/api" || path.startsWith("/api/");
    const canFallBack =
      !isApi &&
      (request.method === "GET" || request.method === "HEAD") &&
      extname(path) === "" &&
      wantsHtml(request);
    if (canFallBack) {
      const underApp = path === "/app" || path.startsWith("/app/");
      if (underApp && mobileDir) return sendIndex(reply, mobileDir);
      if (!underApp && portalDir) return sendIndex(reply, portalDir);
    }
    return reply.code(404).send({
      message: `Route ${request.method}:${path} not found`,
      error: "Not Found",
      statusCode: 404,
    });
  });
}
