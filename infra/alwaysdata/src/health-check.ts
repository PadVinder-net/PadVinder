import { z } from "zod";

export type HealthCheckOptions = {
  /** The site's base URL; `/api/health` is appended. */
  url: string;
  /** The full commit the restarted API must report. */
  commit: string;
  /** The worker's last heartbeat must be later than this: the moment of the restart. */
  heartbeatAfter: Date;
  /** Default 180 s. */
  timeoutMs?: number;
  /** Default 5 s. */
  intervalMs?: number;
  fetch?: typeof fetch;
};

// Only the fields the check needs; the full contract is in @padvinder/contracts.
const healthSchema = z.looseObject({
  status: z.string(),
  commit: z.string(),
  worker: z.looseObject({ lastHeartbeatAt: z.string().nullable() }),
});

/** One request may take at most this long, so a hanging request cannot outlast the timeout. */
const requestTimeoutMs = 10_000;
const maxBodyLength = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const short = (commit: string) => commit.slice(0, 7);

/** Why a 200 answer is not yet the new release, or undefined when it is. */
function mismatch(
  body: z.infer<typeof healthSchema>,
  options: HealthCheckOptions,
): string | undefined {
  const problems: string[] = [];
  if (body.commit !== options.commit) {
    problems.push(`commit ${short(body.commit) || "(none)"} instead of ${short(options.commit)}`);
  }
  if (body.status !== "ok") problems.push(`status ${body.status}`);
  const beat = body.worker.lastHeartbeatAt;
  const beatTime = beat === null ? Number.NaN : Date.parse(beat);
  if (!(beatTime > options.heartbeatAfter.getTime())) {
    problems.push(
      `worker heartbeat ${beat ?? "(none)"} is not after the restart at ${options.heartbeatAfter.toISOString()}`,
    );
  }
  return problems.length === 0 ? undefined : problems.join(", ");
}

/**
 * Polls `<url>/api/health` until it answers 200 with the expected commit, status `ok` and a
 * worker heartbeat after `heartbeatAfter`. A restart may return before the old process has
 * stopped, so an answer from the old release, or a heartbeat from before the restart, does
 * not count. Throws after the timeout with the last answer (the health body holds no secrets).
 */
export async function checkHealth(options: HealthCheckOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const doFetch = options.fetch ?? fetch;
  const endpoint = `${options.url.replace(/\/+$/, "")}/api/health`;
  const deadline = Date.now() + timeoutMs;
  // The last real answer, and the error of the last request if it got none: a request cut
  // off at the end must not hide what the server said before.
  let lastAnswer: string | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await doFetch(`${endpoint}?nocache=${Date.now()}x${attempt}`, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        // A full request time, also for the last request; the check may end that much later.
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const text = await response.text();
      const answer = `HTTP ${response.status}: ${text.slice(0, maxBodyLength)}`;
      lastError = undefined;
      if (response.status !== 200) {
        lastAnswer = answer;
      } else {
        let parsed: z.infer<typeof healthSchema> | undefined;
        try {
          parsed = healthSchema.parse(JSON.parse(text));
        } catch {
          parsed = undefined;
        }
        const problem = parsed === undefined ? "not a health answer" : mismatch(parsed, options);
        if (problem === undefined) return;
        lastAnswer = `${problem}; ${answer}`;
      }
    } catch (error) {
      lastError = `no answer: ${error instanceof Error ? error.message : String(error)}`;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `${endpoint} did not answer with commit ${short(options.commit)}, status ok and a fresh worker heartbeat within ${Math.round(timeoutMs / 1000)} s. Last answer: ${lastAnswer ?? "none"}${lastError === undefined ? "" : `. The last request got ${lastError}`}`,
      );
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
