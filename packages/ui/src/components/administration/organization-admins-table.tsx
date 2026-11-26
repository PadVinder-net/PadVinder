import type { OrganizationAdmin } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { mailHref } from "../contact-rows";
import { RowMenu } from "../row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type OrganizationAdminsTableProps = {
  admins: OrganizationAdmin[];
  canRemove: boolean;
  onRemove(admin: OrganizationAdmin): void;
  /** Adds the row action "Verwijder toegangssleutels" where `admin.mayResetPasskeys`. */
  onResetPasskeys?(admin: OrganizationAdmin): void;
};

export function OrganizationAdminsTable({
  admins,
  canRemove,
  onRemove,
  onResetPasskeys,
}: OrganizationAdminsTableProps) {
  const showMenu = canRemove || onResetPasskeys !== undefined;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>E-mailadres</TableHead>
          {showMenu ? <TableHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {admins.map((admin) => {
          const name = displayName(admin.name, admin.hasLoggedIn);
          return (
            <TableRow key={admin.userId}>
              <TableCell>
                {name}
                {admin.hasPasskey ? null : (
                  <span className="block text-sm text-muted-foreground">
                    Nog geen toegangssleutel
                  </span>
                )}
              </TableCell>
              <TableCell>
                <a href={mailHref(admin.email)} className="underline underline-offset-4 break-all">
                  {admin.email}
                </a>
              </TableCell>
              {showMenu ? (
                <TableCell>
                  <div className="flex justify-end">
                    <RowMenu
                      label={`Acties voor ${name}`}
                      items={[
                        ...(canRemove
                          ? [
                              {
                                label: "Verwijder als beheerder",
                                onSelect: () => onRemove(admin),
                                destructive: true,
                              },
                            ]
                          : []),
                        ...(onResetPasskeys && admin.mayResetPasskeys
                          ? [
                              {
                                label: "Verwijder toegangssleutels",
                                onSelect: () => onResetPasskeys(admin),
                                destructive: true,
                              },
                            ]
                          : []),
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
