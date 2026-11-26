import type { AccountSummary } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { apiErrorMessage } from "../../lib/messages";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export type AccountSummaryCardProps = {
  account: AccountSummary;
  /** The actor's own account: it is deleted in the app, so there is no button. */
  own: boolean;
  onDelete(): void;
};

export function AccountSummaryCard({ account, own, onDelete }: AccountSummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{displayName(account.name, account.hasLoggedIn)}</h2>
        </CardTitle>
        <p className="break-all text-muted-foreground">{account.email}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {account.isPlatformAdmin ? <p className="font-medium">Hoofdbeheerder</p> : null}
        {account.organizationAdminOf.map((organization) => (
          <p key={organization.id}>Beheerder van {organization.name}</p>
        ))}
        <div>
          <h3 className="font-medium">Werkgroepen</h3>
          {account.workingGroups.length === 0 ? (
            <p>Geen werkgroepen.</p>
          ) : (
            <ul>
              {account.workingGroups.map((group) => (
                <li key={group.id}>
                  {group.name} · {group.organization.name}
                  {group.isCoordinator ? " (coördinator)" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        {own ? (
          <p>{apiErrorMessage("own_account")}</p>
        ) : (
          <Button variant="destructive" onClick={onDelete}>
            Verwijder account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
