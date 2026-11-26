import type { AuditActionGroup } from "@padvinder/contracts";
import { auditActionGroupLabels } from "../../lib/audit-log";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

/** `null` is no filter: everything the reader may see. */
export type AuditLogFilterValue = {
  organizationId: string | null;
  actionGroup: AuditActionGroup | null;
};

export type AuditLogFiltersProps = {
  /** The organizations to filter on; the select shows only with more than one. */
  organizations: { id: string; name: string }[];
  /** The kinds of action to filter on, in the order given. */
  actionGroups: AuditActionGroup[];
  value: AuditLogFilterValue;
  onChange(value: AuditLogFilterValue): void;
};

// Radix's select takes no empty value, so "all" has a value no ID or group can have.
const ALL = "*";

export function AuditLogFilters({
  organizations,
  actionGroups,
  value,
  onChange,
}: AuditLogFiltersProps) {
  return (
    <div className="flex flex-wrap gap-4">
      {organizations.length > 1 ? (
        <div className="flex w-80 flex-col gap-2">
          <Label htmlFor="audit-log-organization" className="text-base">
            Organisatie
          </Label>
          <Select
            value={value.organizationId ?? ALL}
            onValueChange={(chosen) =>
              onChange({ ...value, organizationId: chosen === ALL ? null : chosen })
            }
          >
            <SelectTrigger id="audit-log-organization" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle organisaties</SelectItem>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex w-64 flex-col gap-2">
        <Label htmlFor="audit-log-action-group" className="text-base">
          Actie
        </Label>
        <Select
          value={value.actionGroup ?? ALL}
          onValueChange={(chosen) =>
            onChange({
              ...value,
              actionGroup: actionGroups.find((group) => group === chosen) ?? null,
            })
          }
        >
          <SelectTrigger id="audit-log-action-group" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle acties</SelectItem>
            {actionGroups.map((group) => (
              <SelectItem key={group} value={group}>
                {auditActionGroupLabels[group]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
