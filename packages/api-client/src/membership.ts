import { useMutation, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { apiErrorCode } from "./error-messages";
import {
  approveMembershipRequest,
  createMembershipRequest,
  deleteMe,
  rejectMembershipRequest,
  removeMembership,
  withdrawMembershipRequest,
  type CreateMembershipRequestInput,
  type MembershipRequest,
  type MembershipRequestForReview,
  type MeResponse,
  type WorkingGroupSummary,
} from "./generated";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";
import { clearOtherUserData, refetchMe } from "./me-query";

/** The operation a query belongs to: the `_id` the generated query keys carry. */
function operationOf(query: Query): string | undefined {
  return (query.queryKey[0] as { _id?: string } | undefined)?._id;
}

/**
 * Refetches the request lists and the open requests. With a `workingGroupId`, only the list of
 * that group and the requests that belong to it (or whose group is not known yet).
 */
export function refetchMembershipRequests(queryClient: QueryClient, workingGroupId?: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const operation = operationOf(query);
      if (operation === "listMembershipRequests") {
        const path = (query.queryKey[0] as { path?: { workingGroupId?: string } }).path;
        return workingGroupId === undefined || path?.workingGroupId === workingGroupId;
      }
      if (operation === "getMembershipRequest") {
        const request = query.state.data as MembershipRequestForReview | undefined;
        return (
          workingGroupId === undefined ||
          request === undefined ||
          request.workingGroup.id === workingGroupId
        );
      }
      return false;
    },
  });
}

/** Refetches every member list. */
export function refetchMembers(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => operationOf(query) === "listMembers",
  });
}

/**
 * Asks to join a working group. The caller makes `id` (a UUIDv7) and `requestedAt` once, when the
 * user taps, and passes the same variables again on a second tap: the server stores one request
 * per `id`. A network failure (no answer from our API, also a proxy's page during a deploy) is
 * retried three times with the same variables; an answer from the API is not. `already_requested`
 * and `already_member` count as done: the data is then `null`. After success me is refetched, so
 * the gate moves on to the waiting screen or the tabs.
 */
export function useCreateMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateMembershipRequestInput): Promise<MembershipRequest | null> => {
      try {
        const { data } = await createMembershipRequest({ body, throwOnError: true });
        return data;
      } catch (error) {
        const code = apiErrorCode(error);
        if (code === "already_requested" || code === "already_member") return null;
        throw error;
      }
    },
    retry: (failureCount, error) => failureCount < 3 && apiErrorCode(error) === null,
    onSuccess: () => refetchMe(queryClient),
  });
}

/** Withdraws the user's own pending request. Me is refetched also after an error (for example a request that was approved in the meantime). */
export function useWithdrawMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data } = await withdrawMembershipRequest({ path: { id }, throwOnError: true });
      return data;
    },
    onSettled: () => refetchMe(queryClient),
  });
}

/**
 * Approves a request: the applicant becomes a volunteer. The request and member lists are
 * refetched also after an error, which usually means the list was out of date
 * (`already_decided`, `not_found`).
 */
export function useApproveMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data } = await approveMembershipRequest({ path: { id }, throwOnError: true });
      return data;
    },
    onSettled: () => {
      refetchMembershipRequests(queryClient);
      refetchMembers(queryClient);
    },
  });
}

/** Rejects a request. The request lists are refetched also after an error. */
export function useRejectMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data } = await rejectMembershipRequest({ path: { id }, throwOnError: true });
      return data;
    },
    onSettled: () => refetchMembershipRequests(queryClient),
  });
}

/** Removes a member from a working group. The member lists are refetched also after an error (`membership_changed`, `not_found`). */
export function useRemoveMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ membershipId }: { membershipId: string }) => {
      await removeMembership({ path: { membershipId }, throwOnError: true });
    },
    onSettled: () => refetchMembers(queryClient),
  });
}

/** The key of `useDeleteAccount`, so a screen can see with `useMutationState` that it succeeded. */
export const deleteAccountMutationKey = ["deleteAccount"] as const;

/**
 * Deletes the user's own account. On success the whole cache of the user is cleared: me becomes
 * `null` (the gate shows the login screen) and every other query is removed. The last platform
 * admin gets `last_platform_admin` and keeps everything.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: deleteAccountMutationKey,
    mutationFn: async () => {
      await deleteMe({ throwOnError: true });
    },
    onSuccess: () => {
      queryClient.setQueryData(getMeQueryKey(), null);
      clearOtherUserData(queryClient, { keepMutations: true });
    },
  });
}

/**
 * The working groups whose requests the user reviews: those they coordinate, and every group of
 * an organization they administer. Each once, in the order of `directory` (the list of all
 * working groups).
 */
export function reviewableWorkingGroups(
  me: MeResponse,
  directory: WorkingGroupSummary[],
): WorkingGroupSummary[] {
  const coordinated = new Set(
    me.memberships
      .filter((membership) => membership.isCoordinator)
      .map((membership) => membership.workingGroup.id),
  );
  return withAdministered(me, directory, coordinated);
}

/**
 * The working groups whose members the user sees: those they are a member of, and every group of
 * an organization they administer. Each once, in the order of `directory`.
 */
export function memberListWorkingGroups(
  me: MeResponse,
  directory: WorkingGroupSummary[],
): WorkingGroupSummary[] {
  const memberOf = new Set(me.memberships.map((membership) => membership.workingGroup.id));
  return withAdministered(me, directory, memberOf);
}

function withAdministered(
  me: MeResponse,
  directory: WorkingGroupSummary[],
  groupIds: Set<string>,
): WorkingGroupSummary[] {
  const administered = new Set(me.organizationAdminOf.map((organization) => organization.id));
  return directory.filter(
    (group) => groupIds.has(group.id) || administered.has(group.organization.id),
  );
}

/** The strongest relation a user has to a working group; the same order as on the server. */
export type WorkingGroupRelation =
  | "platformAdmin"
  | "organizationAdmin"
  | "coordinator"
  | "volunteer"
  | "outsider";

/**
 * The app's copy of the server's `relationTo` (apps/api/src/permissions/rules.ts), read from me.
 * Only for showing or hiding buttons: the API decides, and the app shows its answer.
 */
export function relationToWorkingGroup(
  me: MeResponse,
  group: WorkingGroupSummary,
): WorkingGroupRelation {
  if (me.user.isPlatformAdmin) return "platformAdmin";
  if (me.organizationAdminOf.some((organization) => organization.id === group.organization.id))
    return "organizationAdmin";
  const membership = me.memberships.find((m) => m.workingGroup.id === group.id);
  if (!membership) return "outsider";
  return membership.isCoordinator ? "coordinator" : "volunteer";
}

const staff: readonly WorkingGroupRelation[] = [
  "platformAdmin",
  "organizationAdmin",
  "coordinator",
];

/** Coordinators and admins open a member to see the contact details. */
export function mayOpenMembers(me: MeResponse, group: WorkingGroupSummary): boolean {
  return staff.includes(relationToWorkingGroup(me, group));
}

/** A coordinator removes volunteers of their group; admins remove anyone. */
export function mayRemoveMember(
  me: MeResponse,
  group: WorkingGroupSummary,
  memberIsCoordinator: boolean,
): boolean {
  const relation = relationToWorkingGroup(me, group);
  if (relation === "coordinator") return !memberIsCoordinator;
  return staff.includes(relation);
}
