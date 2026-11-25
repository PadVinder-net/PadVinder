import type { OrganizationAdmin } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { mailHref } from "../contact-rows";
import { RowMenu } from "../row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type OrganizationAdminsTableProps = {
  admins: OrganizationAdmin[];
  canRemove: boolean;
  onRemove(admin: OrganizationAdmin): void;
};

export function OrganizationAdminsTable({
  admins,
  canRemove,
  onRemove,
}: OrganizationAdminsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>E-mailadres</TableHead>
          {canRemove ? <TableHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {admins.map((admin) => {
          const name = displayName(admin.name, admin.hasLoggedIn);
          return (
            <TableRow key={admin.userId}>
              <TableCell>{name}</TableCell>
              <TableCell>
                <a href={mailHref(admin.email)} className="underline underline-offset-4 break-all">
                  {admin.email}
                </a>
              </TableCell>
              {canRemove ? (
                <TableCell>
                  <div className="flex justify-end">
                    <RowMenu
                      label={`Acties voor ${name}`}
                      items={[
                        {
                          label: "Verwijder als beheerder",
                          onSelect: () => onRemove(admin),
                          destructive: true,
                        },
                      ]}
                    />
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
