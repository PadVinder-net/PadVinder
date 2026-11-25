import type { Member } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { mailHref, telHref } from "../contact-rows";
import { RowMenu, type RowMenuItem } from "../row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type MembersTableProps = {
  members: Member[];
  canSetCoordinator: boolean;
  canRemove(member: Member): boolean;
  onSetCoordinator(member: Member, isCoordinator: boolean): void;
  onRemove(member: Member): void;
};

const linkClass = "underline underline-offset-4 break-all";

export function MembersTable({
  members,
  canSetCoordinator,
  canRemove,
  onSetCoordinator,
  onRemove,
}: MembersTableProps) {
  if (members.length === 0) {
    return <p className="text-lg">Deze werkgroep heeft nog geen leden.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>E-mailadres</TableHead>
          <TableHead>Telefoonnummer</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const name = displayName(member.name, member.hasLoggedIn);
          const items: RowMenuItem[] = [];
          if (canSetCoordinator) {
            items.push({
              label: member.isCoordinator ? "Niet langer coördinator" : "Maak coördinator",
              onSelect: () => onSetCoordinator(member, !member.isCoordinator),
            });
          }
          if (canRemove(member)) {
            items.push({
              label: "Verwijder uit werkgroep",
              onSelect: () => onRemove(member),
              destructive: true,
            });
          }
          return (
            <TableRow key={member.membershipId}>
              <TableCell>
                <span className={member.isCoordinator ? "font-bold" : undefined}>{name}</span>
                {member.isCoordinator ? (
                  <span className="block text-sm text-muted-foreground">Coördinator</span>
                ) : null}
              </TableCell>
              <TableCell>
                {member.email !== undefined ? (
                  <a href={mailHref(member.email)} className={linkClass}>
                    {member.email}
                  </a>
                ) : null}
              </TableCell>
              <TableCell>
                {member.phone ? (
                  telHref(member.phone) ? (
                    <a href={telHref(member.phone)} className={linkClass}>
                      {member.phone}
                    </a>
                  ) : (
                    member.phone
                  )
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <RowMenu label={`Acties voor ${name}`} items={items} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
