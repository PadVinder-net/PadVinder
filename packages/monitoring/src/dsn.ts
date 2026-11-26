/** The parts of a Sentry DSN, `<protocol>://<public key>@<host>[:<port>][/<path>]/<project ID>`. */
export type Dsn = {
  publicKey: string;
  /** The host name, without the port. */
  host: string;
  projectId: string;
  /** Where the SDK posts its envelopes: `<protocol>//<host>[:<port>][/<path>]/api/<project ID>/envelope/`. */
  ingestUrl: string;
};

/** Why a value is not a DSN. Its message never holds the value: a DSN holds the project's key. */
export class DsnError extends Error {
  override name = "DsnError";
}

/**
 * Reads a Sentry DSN strictly: an http or https URL with a public key (the user name), a host and
 * a numeric project ID as its last path segment, without a query or fragment. Sentry itself only
 * logs `Invalid Sentry Dsn: <value>` and sends nothing, so the services check first.
 * `infra/alwaysdata/src/config.ts` applies the same rule (https only) and must stay in step.
 */
export function parseDsn(value: string): Dsn {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DsnError("not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DsnError("must use https or http");
  }
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) {
    throw new DsnError("must not have a query or fragment");
  }
  if (!/^\w+$/.test(url.username)) {
    throw new DsnError("has no public key before the @");
  }
  const segments = url.pathname.split("/");
  const projectId = segments.pop() ?? "";
  if (!/^\d+$/.test(projectId)) {
    throw new DsnError("has no project ID (a number) at the end of its path");
  }
  const path = segments.join("/");
  return {
    publicKey: url.username,
    host: url.hostname,
    projectId,
    ingestUrl: `${url.protocol}//${url.host}${path}/api/${projectId}/envelope/`,
  };
}
