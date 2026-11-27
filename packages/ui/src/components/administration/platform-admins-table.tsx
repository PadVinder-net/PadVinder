import type { PlatformAdmin } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { mailHref } from "../contact-rows";
import { RowMenu } from "../row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type PlatformAdminsTableProps = {
  admins: PlatformAdmin[];
  onRemove(admin: PlatformAdmin): void;
  /** Adds the row action "Verwijder toegangssleutels" where `canResetPasskeys(admin)`. */
  onResetPasskeys?(admin: PlatformAdmin): void;
  canResetPasskeys?(admin: PlatformAdmin): boolean;
};

export function PlatformAdminsTable({
  admins,
  onRemove,
  onResetPasskeys,
  canResetPasskeys,
}: PlatformAdminsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead>E-mailadres</TableHead>
          <TableHead />
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
              <TableCell>
                <div className="flex justify-end">
                  <RowMenu
                    label={`Acties voor ${admin.name.trim() === "" ? admin.email : admin.name}`}
                    items={[
                      {
                        label: "Verwijder als hoofdbeheerder",
                        onSelect: () => onRemove(admin),
                        destructive: true,
                      },
                      ...(onResetPasskeys && canResetPasskeys?.(admin)
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
