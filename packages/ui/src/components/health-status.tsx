import type { HealthResponse } from "@padvinder/contracts";
import { formatDateTime } from "../lib/format";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export type HealthStatusProps = {
  /** Leave out while the status is loading. */
  health?: HealthResponse;
  loadFailed?: boolean;
};

export function HealthStatus({ health, loadFailed = false }: HealthStatusProps) {
  return (
    <Card className="text-lg">
      <CardHeader>
        <CardTitle className="text-2xl">
          <h2>Systeemstatus</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Body health={health} loadFailed={loadFailed} />
      </CardContent>
    </Card>
  );
}

function Body({
  health,
  loadFailed,
}: Required<Pick<HealthStatusProps, "loadFailed">> & HealthStatusProps) {
  if (loadFailed) {
    return <p role="alert">De server is niet bereikbaar. Probeer het straks opnieuw.</p>;
  }
  if (!health) {
    return <p role="status">Systeemstatus laden…</p>;
  }

  const ok = health.status === "ok";
  const { database, worker } = health;
  const heartbeat = worker.lastHeartbeatAt
    ? `Laatste hartslag: ${formatDateTime(worker.lastHeartbeatAt)}`
    : "Nog geen hartslag";

  const rows: [label: string, value: string][] = [
    ["Database", database.reachable ? "Verbonden" : "Niet bereikbaar"],
    ["PostgreSQL", database.postgresVersion ?? "Onbekend"],
    ["PostGIS", database.postgisVersion ?? "Niet geïnstalleerd"],
    ["Laatste migratie", database.latestMigration?.name ?? "Onbekend"],
    ["Achtergrondtaken", heartbeat],
    ["Versie", health.commit.slice(0, 7)],
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* The text carries the meaning; the color only reinforces it. */}
      <Badge
        variant={ok ? "secondary" : "destructive"}
        className={ok ? "bg-green-800 px-3 py-1 text-lg text-white" : "px-3 py-1 text-lg"}
      >
        {ok ? "Alles werkt" : "Er is een storing"}
      </Badge>
      <dl className="grid grid-cols-1 gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-base text-muted-foreground">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
