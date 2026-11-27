import {
  apiErrorCode,
  healthQueryOptions,
  useHealthLiveUpdates,
  useTestSentryConnection,
} from "@padvinder/api-client";
import type { SentryConnectionResult } from "@padvinder/contracts";
import { apiErrorMessage, Button, HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";

/** Only mounted for platform admins (`RequirePlatformAdmin`), so nobody else fetches or streams the status. */
export function SystemPage() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Systeemstatus</h1>
      <HealthStatus health={data} loadFailed={isError} />
      <SentryConnectionTest />
    </main>
  );
}

/** One line per address family: arrived, refused (with the answer) or no answer. */
function resultLine({ family, status, answer }: SentryConnectionResult): string {
  if (status === "unreachable") return `IPv${family}: geen antwoord (${answer ?? "onbekend"})`;
  if (status >= 200 && status <= 299) return `IPv${family}: aangekomen (${status})`;
  return `IPv${family}: geweigerd (${status})${answer ? `: ${answer}` : ""}`;
}

/** "Test de verbinding": whether this server reaches Sentry over IPv4 and over IPv6. */
function SentryConnectionTest() {
  const connectionTest = useTestSentryConnection();
  const { data, error, isPending } = connectionTest;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xl font-bold">Verbinding met Sentry</h2>
      <p className="mb-4">
        Stuur een testmelding naar Sentry, één keer via IPv4 en één keer via IPv6. Zo zie je of deze
        server Sentry kan bereiken.
      </p>
      <Button size="lg" disabled={isPending} onClick={() => connectionTest.mutate()}>
        Test de verbinding
      </Button>
      <div className="mt-4" aria-live="polite">
        {error ? (
          <p role="alert">{apiErrorMessage(apiErrorCode(error))}</p>
        ) : data?.sentryOff ? (
          <p>Sentry staat uit op deze server: SENTRY_DSN ontbreekt.</p>
        ) : data ? (
          <ul>
            {data.results.map((result) => (
              <li key={result.family}>{resultLine(result)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
