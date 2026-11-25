import type { ManagedWorkingGroup } from "@padvinder/contracts";
import { cn } from "../../lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type WorkingGroupTableProps = {
  /** Shown in the order given. */
  workingGroups: ManagedWorkingGroup[];
  onOpen(id: string): void;
};

export function WorkingGroupTable({ workingGroups, onOpen }: WorkingGroupTableProps) {
  if (workingGroups.length === 0) {
    return <p className="text-lg">Er zijn nog geen werkgroepen.</p>;
  }
  const showOrganization = new Set(workingGroups.map((g) => g.organization.id)).size > 1;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>Plaats</TableHead>
          {showOrganization ? <TableHead>Organisatie</TableHead> : null}
          <TableHead>Leden</TableHead>
          <TableHead>Aanmeldingen</TableHead>
          <TableHead>Actief</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workingGroups.map((group) => (
          <TableRow key={group.id} className={cn(!group.active && "text-muted-foreground")}>
            <TableCell>
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => onOpen(group.id)}
              >
                {group.name}
              </button>
            </TableCell>
            <TableCell>{group.city}</TableCell>
            {showOrganization ? <TableCell>{group.organization.name}</TableCell> : null}
            <TableCell>{group.memberCount}</TableCell>
            <TableCell>{group.pendingRequestCount}</TableCell>
            <TableCell>{group.active ? "ja" : "nee"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
