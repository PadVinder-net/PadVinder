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
  // Every connection wrapped during this recording, restored afterwards: pooled connections are
  // reused, and a wrapper left behind would write into this recording's log forever.
  const restores: Array<() => void> = [];
  const wrapped = new Set<unknown>();
  poolAny.query = function (this: unknown, ...args: unknown[]) {
    log.push(textOf(args[0]));
    return originalQuery.apply(pool, args);
  };
  poolAny.connect = function (this: unknown, ...args: unknown[]) {
    const result = originalConnect.apply(pool, args) as Promise<pg.PoolClient> | undefined;
    if (!result || typeof result.then !== "function") return result;
    return result.then((client) => {
      const clientAny = client as unknown as { query: (...a: unknown[]) => unknown };
      // The same client taken again in this recording is wrapped already: once is enough.
      if (wrapped.has(client)) return client;
      wrapped.add(client);
      const original = clientAny.query;
      clientAny.query = function (this: unknown, ...a: unknown[]) {
        log.push(textOf(a[0]));
        return original.apply(client, a);
      };
      restores.push(() => {
        clientAny.query = original;
      });
      return client;
    });
  };
  try {
    await fn();
  } finally {
    poolAny.query = originalQuery;
    poolAny.connect = originalConnect;
    for (const restore of restores) restore();
  }
  return log;
}
