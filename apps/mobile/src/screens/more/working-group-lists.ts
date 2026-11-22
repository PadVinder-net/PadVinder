import {
  listMembersOptions,
  listMembershipRequestsOptions,
  listWorkingGroupsOptions,
  memberListWorkingGroups,
  reviewableWorkingGroups,
  type Member,
  type MembershipRequestForReview,
  type MeResponse,
  type WorkingGroupSummary,
} from "@padvinder/api-client";
import { useQueries, useQuery } from "@tanstack/react-query";

/** The part of a query result that `combine` reads. */
type Loaded<D> = {
  data: D | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch(): Promise<unknown>;
};

type PerGroup<T> = {
  groups: ({ workingGroup: WorkingGroupSummary } & T)[];
  isPending: boolean;
  /** The first failure: of the list of working groups, or of one group's list. */
  error: unknown;
  refetch(): void;
};

function combine<D, T extends object>(
  directory: Loaded<unknown>,
  workingGroups: WorkingGroupSummary[],
  lists: Loaded<D>[],
  pick: (data: D | undefined) => T,
): PerGroup<T> {
  return {
    groups: workingGroups.map((workingGroup, index) => ({
      workingGroup,
      ...pick(lists[index]?.data),
    })),
    isPending: directory.isPending || lists.some((list) => list.isPending),
    error: directory.error ?? lists.find((list) => list.isError)?.error ?? null,
    refetch: () => {
      void directory.refetch();
      for (const list of lists) if (list.isError) void list.refetch();
    },
  };
}

/** The list of all active working groups; the groups below are taken from it. */
export function useWorkingGroupDirectory() {
  return useQuery(listWorkingGroupsOptions());
}

/** The open requests of every group the user reviews (`reviewableWorkingGroups`), one query per group. */
export function useRequestLists(me: MeResponse) {
  const directory = useWorkingGroupDirectory();
  const workingGroups = directory.data
    ? reviewableWorkingGroups(me, directory.data.workingGroups)
    : [];
  const lists = useQueries({
    queries: workingGroups.map((group) =>
      listMembershipRequestsOptions({ path: { workingGroupId: group.id } }),
    ),
  });
  return combine(directory, workingGroups, lists, (data) => ({
    requests: data?.membershipRequests ?? ([] as MembershipRequestForReview[]),
  }));
}

/** The members of every group whose members the user sees (`memberListWorkingGroups`). */
export function useMemberLists(me: MeResponse) {
  const directory = useWorkingGroupDirectory();
  const workingGroups = directory.data
    ? memberListWorkingGroups(me, directory.data.workingGroups)
    : [];
  const lists = useQueries({
    queries: workingGroups.map((group) =>
      listMembersOptions({ path: { workingGroupId: group.id } }),
    ),
  });
  return combine(directory, workingGroups, lists, (data) => ({
    members: data?.members ?? ([] as Member[]),
  }));
}
