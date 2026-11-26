import type pg from "pg";

/**
 * The SQL text of every query that `fn` makes through `pool`, in order: queries on the pool itself
 * and on connections taken from it (transactions). Tests only. Needs the app to use this pool
 * (`ctx.t.pool` does), and nothing else to run against it meanwhile.
 */
export async function recordQueries(pool: pg.Pool, fn: () => Promise<unknown>): Promise<string[]> {
  const log: string[] = [];
  const textOf = (first: unknown) =>
    typeof first === "string" ? first : ((first as { text?: string } | undefined)?.text ?? "?");
  const poolAny = pool as unknown as {
    query: (...args: unknown[]) => unknown;
    connect: (...args: unknown[]) => unknown;
  };
  const originalQuery = poolAny.query;
  const originalConnect = poolAny.connect;
  poolAny.query = function (this: unknown, ...args: unknown[]) {
    log.push(textOf(args[0]));
    return originalQuery.apply(pool, args);
  };
  poolAny.connect = function (this: unknown, ...args: unknown[]) {
    const result = originalConnect.apply(pool, args) as Promise<pg.PoolClient> | undefined;
    if (!result || typeof result.then !== "function") return result;
    return result.then((client) => {
      const clientAny = client as unknown as { query: (...a: unknown[]) => unknown };
      if (!(clientAny.query as { recorded?: boolean }).recorded) {
        const original = clientAny.query;
        const wrapped = function (this: unknown, ...a: unknown[]) {
          log.push(textOf(a[0]));
          return original.apply(client, a);
        };
        (wrapped as { recorded?: boolean }).recorded = true;
        clientAny.query = wrapped;
      }
      return client;
    });
  };
  try {
    await fn();
  } finally {
    poolAny.query = originalQuery;
    poolAny.connect = originalConnect;
  }
  return log;
}
