import { useInfiniteQuery } from "@tanstack/react-query";
import type { AuditActionGroup, AuditLogEntry } from "./generated";
import { listAuditLogEntriesInfiniteOptions } from "./generated/@tanstack/react-query.gen";
import { apiErrorCode } from "./error-messages";

/**
 * The audit log, newest first, one page at a time. The filters are in the query key, so a changed
 * filter starts at the first page. `entries` is every loaded page in order; `loadMore` asks for
 * the page after the last one with its `nextCursor`. A failed `loadMore` keeps what was loaded.
 */
export function useAuditLog(filters: { organizationId?: string; actionGroup?: AuditActionGroup }) {
  const query = useInfiniteQuery({
    ...listAuditLogEntriesInfiniteOptions({
      query: {
        ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        ...(filters.actionGroup ? { actionGroup: filters.actionGroup } : {}),
      },
    }),
    initialPageParam: {},
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: (failureCount, error) => apiErrorCode(error) !== "not_found" && failureCount < 3,
  });
  const entries: AuditLogEntry[] = query.data?.pages.flatMap((page) => page.entries) ?? [];
  return {
    entries,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    loadingMore: query.isFetchingNextPage,
    loadMoreFailed: query.isFetchNextPageError,
    isPending: query.isPending,
    // Only a failed first load: a failed `loadMore` keeps its rows and sets `loadMoreFailed`.
    error: query.data ? null : query.error,
    refetch: () => void query.refetch(),
  };
}
