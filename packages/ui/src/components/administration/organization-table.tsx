import type { Organization } from "@padvinder/contracts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type OrganizationTableProps = {
  /** Shown in the order given. */
  organizations: Organization[];
  onOpen(id: string): void;
};

export function OrganizationTable({ organizations, onOpen }: OrganizationTableProps) {
  if (organizations.length === 0) {
    return <p className="text-lg">Er zijn nog geen organisaties.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>Contactadres</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {organizations.map((organization) => (
          <TableRow key={organization.id}>
            <TableCell>
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => onOpen(organization.id)}
              >
                {organization.name}
              </button>
            </TableCell>
            <TableCell>{organization.contactEmail}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
