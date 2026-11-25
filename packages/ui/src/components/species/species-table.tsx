import type { Species } from "@padvinder/contracts";
import { capitalizeFirst } from "../../lib/text";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type SpeciesTableProps = {
  /** Shown in the order given. */
  species: Species[];
  onEdit(id: string): void;
  onSetActive(id: string, active: boolean): void;
};

const yesNo = (value: boolean) => (value ? "ja" : "nee");

export function SpeciesTable({ species, onEdit, onSetActive }: SpeciesTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nederlandse naam</TableHead>
          <TableHead>Wetenschappelijke naam</TableHead>
          <TableHead>Betrouwbaarheidscheck</TableHead>
          <TableHead>Actief</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {species.map((item) => (
          <TableRow key={item.id} className={cn(!item.active && "text-muted-foreground")}>
            <TableCell>{capitalizeFirst(item.dutchName)}</TableCell>
            <TableCell>
              <em>{item.scientificName}</em>
            </TableCell>
            <TableCell>{yesNo(item.needsVerification)}</TableCell>
            <TableCell>{yesNo(item.active)}</TableCell>
            <TableCell className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onEdit(item.id)}>
                Wijzig
              </Button>
              <Button variant="outline" onClick={() => onSetActive(item.id, !item.active)}>
                {item.active ? "Zet uit" : "Zet aan"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
