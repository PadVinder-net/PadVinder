import type { AuditLogEntry } from "@padvinder/contracts";
import { auditLogPersonName, auditLogSentence } from "../../lib/audit-log";
import { formatDateTime } from "../../lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type AuditLogTableProps = {
  /** Shown in the order given: newest first, as the API sends them. */
  entries: AuditLogEntry[];
  /** Add the column Organisatie, for a list that spans more than one organization. */
  showOrganization: boolean;
};

export function AuditLogTable({ entries, showOrganization }: AuditLogTableProps) {
  if (entries.length === 0) {
    return <p className="text-lg">Geen regels gevonden.</p>;
  }
  return (
    <Table className="text-base">
      <TableHeader>
        <TableRow>
          <TableHead>Wanneer</TableHead>
          <TableHead>Wie</TableHead>
          <TableHead>Wat</TableHead>
          {showOrganization ? <TableHead>Organisatie</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="align-top tabular-nums">
              {formatDateTime(entry.occurredAt)}
            </TableCell>
            <TableCell className="align-top">{auditLogPersonName(entry.actor)}</TableCell>
            <TableCell className="align-top whitespace-normal">{auditLogSentence(entry)}</TableCell>
            {showOrganization ? (
              <TableCell className="align-top">{entry.organization?.name ?? ""}</TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
