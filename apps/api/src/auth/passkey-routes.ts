import { apiErrorCodes } from "@padvinder/contracts";
import {
  countPasskeys,
  MAX_PASSKEYS_PER_ACCOUNT,
  recordPasskeyAdded,
  type Db,
  type QueueMail,
} from "@padvinder/db";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { apiError } from "../errors";
import { loadActor } from "../permissions/actor";
import { authorize } from "../permissions/rules";
import { forwardLog, type Auth } from "./auth";
import { clientBody, copyCookies, sendAuthResponse } from "./auth-response";
import { toFetchHeaders } from "./fetch-headers";

/** Better Auth's four passkey routes, the only ones of its plugin the apps use. */
export const PASSKEY_PATHS = [
  "/auth/passkey/generate-register-options",
  "/auth/passkey/verify-registration",
  "/auth/passkey/generate-authenticate-options",
  "/auth/passkey/verify-authentication",
] as const;

type PasskeyPath = (typeof PASSKEY_PATHS)[number];

type Options = { auth: Auth; origin: string; db: Db; queueMail: QueueMail };

/** What the client sent as `response` (the browser's credential), and nothing else. */
function credentialOf(request: FastifyRequest): unknown {
  const body: unknown = request.body;
  if (body === null || typeof body !== "object" || !("response" in body)) return undefined;
  return body.response;
}

/**
 * Better Auth's passkey routes behind our own checks (the design, "Better Auth"). All four are
 * `POST` here, so the Origin check covers them and a `GET` never changes state; the two
 * `generate-*` routes, `GET` in Better Auth, are passed on as `GET`. The bodies are rebuilt, so a
 * client sends Better Auth only the credential. The verify routes answer `{ ok: true }`: Better
 * Auth's answer holds the session token, and the registration's the public key and credential ID.
 */
export const passkeyRoutes: FastifyPluginAsync<Options> = async (
  api,
  { auth, origin, db, queueMail },
) => {
  /** Better Auth's answer to the request, with `method` and `body` instead of the client's. */
  async function passOn(
    request: FastifyRequest,
    path: PasskeyPath,
    { method, body }: { method: "GET" | "POST"; body?: object },
  ): Promise<Response> {
    // Our own origin and path, never the client's Host header or query.
    const url = new URL(`/api${path}`, origin);
    const headers = toFetchHeaders(request, [
      "content-length",
      "transfer-encoding",
      "content-type",
    ]);
    if (body) headers.set("content-type", "application/json");
    try {
      return await auth.handler(
        new Request(url, { method, headers, ...(body && { body: JSON.stringify(body) }) }),
      );
    } catch (error) {
      // Logged scrubbed: a database error can carry a row with an email address.
      forwardLog(request.log)("error", "Unexpected error", error);
      throw apiError(500, apiErrorCodes.internalError, "Internal server error");
    }
  }

  /**
   * Who may add a passkey (the design, "Passkeys"): an admin; for a further one, recently
   * confirmed; fewer than ten. Better Auth's own checks (a session at most a day old) follow.
   */
  async function checkMayAddPasskey(request: FastifyRequest) {
    const actor = await loadActor(api, db, request);
    if (!actor) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    const count = await countPasskeys(db, actor.userId);
    authorize(actor, { action: "passkeys.add", hasPasskey: count > 0 });
    if (count >= MAX_PASSKEYS_PER_ACCOUNT) {
      throw apiError(409, apiErrorCodes.tooManyPasskeys, "This account has the most passkeys");
    }
    return actor;
  }

  /** The session of the cookie, before a verify call replaces it. Not renewed. */
  async function previousSessionToken(request: FastifyRequest): Promise<string | null> {
    const previous = await auth.api.getSession({
      headers: toFetchHeaders(request),
      query: { disableRefresh: true },
    });
    return previous?.session.token ?? null;
  }

  /**
   * After a verify call made a new, confirmed session: the old one is deleted (Better Auth leaves
   * it), so its cookie no longer logs in, and the client gets the new cookie and `{ ok: true }`.
   */
  async function replaceSession(
    request: FastifyRequest,
    reply: FastifyReply,
    response: Response,
    previousToken: string | null,
  ): Promise<FastifyReply> {
    if (previousToken) {
      try {
        await (await auth.$context).internalAdapter.deleteSession(previousToken);
      } catch (error) {
        // Without the old session deleted, the new cookie is not handed out either.
        forwardLog(request.log)("error", "Deleting the replaced session failed", error);
        throw apiError(500, apiErrorCodes.internalError, "Internal server error");
      }
    }
    copyCookies(reply, response);
    return reply.status(200).send({ ok: true });
  }

  const route = (
    url: PasskeyPath,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>,
  ) => api.route({ method: "POST", url, schema: { hide: true }, handler });

  route("/auth/passkey/generate-register-options", async (request, reply) => {
    await checkMayAddPasskey(request);
    const response = await passOn(request, "/auth/passkey/generate-register-options", {
      method: "GET",
    });
    return sendAuthResponse(reply, response, await clientBody(response));
  });

  route("/auth/passkey/verify-registration", async (request, reply) => {
    const actor = await checkMayAddPasskey(request);
    const previousToken = await previousSessionToken(request);
    // A new session, always: adding a passkey confirms the session (the design, "Passkeys").
    const response = await passOn(request, "/auth/passkey/verify-registration", {
      method: "POST",
      body: { response: credentialOf(request), createSession: true },
    });
    if (!response.ok) return sendAuthResponse(reply, response, await clientBody(response));
    const added: unknown = await response.json();
    const passkeyId =
      added !== null && typeof added === "object" && "id" in added && typeof added.id === "string"
        ? added.id
        : null;
    try {
      if (!passkeyId) throw new TypeError("No passkey ID in the registration answer");
      await recordPasskeyAdded(db, { userId: actor.userId, passkeyId }, { queueMail });
    } catch (error) {
      // The passkey exists; the answer stays a success. The class only: no ID or key material.
      request.log.error(
        { errorClass: error instanceof Error ? error.constructor.name : typeof error },
        "Recording an added passkey failed",
      );
    }
    return replaceSession(request, reply, response, previousToken);
  });

  // A passkey confirms a session; nobody logs in with one (the maintainer, 27 November 2026).
  route("/auth/passkey/generate-authenticate-options", async (request, reply) => {
    if (!(await loadActor(api, db, request))) {
      throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    }
    const response = await passOn(request, "/auth/passkey/generate-authenticate-options", {
      method: "GET",
    });
    return sendAuthResponse(reply, response, await clientBody(response));
  });

  route("/auth/passkey/verify-authentication", async (request, reply) => {
    const previousToken = await previousSessionToken(request);
    if (!previousToken) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    const response = await passOn(request, "/auth/passkey/verify-authentication", {
      method: "POST",
      body: { response: credentialOf(request) },
    });
    if (!response.ok) return sendAuthResponse(reply, response, await clientBody(response));
    return replaceSession(request, reply, response, previousToken);
  });
};
