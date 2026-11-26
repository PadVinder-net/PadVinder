import { apiErrorCode, useAuditLog, useMe, useOrganizations } from "@padvinder/api-client";
import { auditActionGroups, type AuditActionGroup, type MeResponse } from "@padvinder/contracts";
import {
  AuditLogFilters,
  type AuditLogFilterValue,
  AuditLogTable,
  Button,
  connectionMessage,
  showToast,
} from "@padvinder/ui";
import { useEffect, useRef, useState } from "react";
import { readsAuditLog } from "../layout/navigation";
import { LoadError } from "./load-error";
import { NotFoundPage } from "./not-found-page";

type Organization = { id: string; name: string };

/** Entries without an organization (accounts, species) are for platform admins only. */
const organizationAdminActionGroups = auditActionGroups.filter(
  (group) => group !== "account" && group !== "species",
);

/**
 * The audit log (`/audit-log`), newest first, with "Laad meer", for platform admins and the admins
 * of an organization. Anyone else sees the not-found page; it follows me, so an admin who loses the
 * role sees it without a reload. The filters live in the page's state; the page does not follow
 * live events and loads again when it is opened.
 */
export function AuditLogPage() {
  const me = useMe();
  if (!me.data || !readsAuditLog(me.data)) return <NotFoundPage />;
  return me.data.user.isPlatformAdmin ? (
    <PlatformAdminAuditLog />
  ) : (
    <OrganizationAdminAuditLog me={me.data} />
  );
}

function PlatformAdminAuditLog() {
  const organizations = useOrganizations();
  return (
    <AuditLog
      organizations={organizations.data?.organizations ?? []}
      actionGroups={[...auditActionGroups]}
    />
  );
}

function OrganizationAdminAuditLog({ me }: { me: MeResponse }) {
  return (
    <AuditLog organizations={me.organizationAdminOf} actionGroups={organizationAdminActionGroups} />
  );
}

function AuditLog({
  organizations,
  actionGroups,
}: {
  organizations: Organization[];
  actionGroups: AuditActionGroup[];
}) {
  const [chosen, setChosen] = useState<AuditLogFilterValue>({
    organizationId: null,
    actionGroup: null,
  });
  // An organization that left the list (no longer theirs) is no filter any more.
  const filters: AuditLogFilterValue = {
    organizationId: organizations.some((organization) => organization.id === chosen.organizationId)
      ? chosen.organizationId
      : null,
    actionGroup: chosen.actionGroup,
  };
  const log = useAuditLog({
    organizationId: filters.organizationId ?? undefined,
    actionGroup: filters.actionGroup ?? undefined,
  });

  // A 404 for the chosen organization: it is no longer theirs. Back to all organizations.
  const organizationGone =
    filters.organizationId !== null && apiErrorCode(log.error) === "not_found";
  useEffect(() => {
    if (organizationGone) setChosen((current) => ({ ...current, organizationId: null }));
  }, [organizationGone]);

  // One toast per failed "Laad meer": the hook's retries all fall within one load.
  const loadingMore = useRef(false);
  useEffect(() => {
    if (log.loadingMore) {
      loadingMore.current = true;
      return;
    }
    if (!loadingMore.current) return;
    loadingMore.current = false;
    if (log.loadMoreFailed) showToast(connectionMessage);
  }, [log.loadingMore, log.loadMoreFailed]);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Logboek</h1>
      <div className="mb-6">
        <AuditLogFilters
          organizations={organizations}
          actionGroups={actionGroups}
          value={filters}
          onChange={setChosen}
        />
      </div>
      {log.error && !organizationGone ? (
        <LoadError onRetry={log.refetch} />
      ) : log.isPending || organizationGone ? (
        <p className="text-lg">Logboek laden…</p>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <AuditLogTable
            entries={log.entries}
            showOrganization={organizations.length > 1 && filters.organizationId === null}
          />
          {log.hasMore ? (
            <Button size="lg" disabled={log.loadingMore} onClick={log.loadMore}>
              {log.loadingMore ? "Even geduld…" : "Laad meer"}
            </Button>
          ) : null}
        </div>
      )}
    </main>
  );
}
