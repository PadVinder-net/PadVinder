import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import {
  addMembers,
  addOrganizationAdmin,
  createOrganization,
  createWorkingGroup,
  getOrganization,
  removeOrganizationAdmin,
  updateMembership,
  updateOrganization,
  updateWorkingGroup,
  type AddMembersRequestInput,
  type AddOrganizationAdminRequestInput,
  type CreateOrganizationRequestInput,
  type CreateWorkingGroupRequestInput,
  type MeResponse,
  type OrganizationDetail,
  type UpdateOrganizationRequestInput,
  type UpdateWorkingGroupRequestInput,
} from "./generated";
import {
  getOrganizationQueryKey,
  listManagedWorkingGroupsOptions,
  listManagedWorkingGroupsQueryKey,
  listOrganizationsOptions,
  listOrganizationsQueryKey,
} from "./generated/@tanstack/react-query.gen";
import { apiErrorCode } from "./error-messages";
import { refetchMe } from "./me-query";
import { refetchMembers } from "./membership";
import { backgroundRequestMeta } from "./passkey-confirmation";
import { waitsForPasskey } from "./query-client";

/**
 * The working groups the user manages: all of them for a platform admin, those of their
 * organizations for an admin. With `background` (the portal's navigation badge) a
 * `passkey_required` does not open the confirmation; a page that shows the list asks.
 */
export function useManagedWorkingGroups({ background = false }: { background?: boolean } = {}) {
  return useQuery({
    ...listManagedWorkingGroupsOptions(),
    ...(background ? { meta: backgroundRequestMeta } : {}),
  });
}

/** The organizations the user administers (all of them for a platform admin). */
export function useOrganizations() {
  return useQuery(listOrganizationsOptions());
}

/**
 * One organization with its admins. A 404 (not there, or not the user's to see) is data: `null`,
 * without a retry, so the page can show its not-found text. It shares the query key of the
 * generated `getOrganizationOptions`, but holds `null` for a 404.
 */
export function useOrganization(organizationId: string) {
  return useQuery({
    queryKey: getOrganizationQueryKey({ path: { organizationId } }),
    queryFn: async ({ signal }): Promise<OrganizationDetail | null> => {
      try {
        const { data } = await getOrganization({
          path: { organizationId },
          signal,
          throwOnError: true,
        });
        return data;
      } catch (error) {
        if (apiErrorCode(error) === "not_found") return null;
        throw error;
      }
    },
  });
}

/**
 * Refetches everything the administration pages show: the managed working groups, the
 * organizations, every organization detail and every member list. Resolves when the queries on
 * screen are fresh (a failed refetch resolves too; the list keeps its data). A query that
 * `waitsForPasskey` is left alone, so a live event does not open the confirmation again.
 */
export async function refetchAdministration(queryClient: QueryClient): Promise<void> {
  const refetchable = (query: Query) => !waitsForPasskey(query);
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: listManagedWorkingGroupsQueryKey(),
      predicate: refetchable,
    }),
    queryClient.invalidateQueries({
      queryKey: listOrganizationsQueryKey(),
      predicate: refetchable,
    }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        (query.queryKey[0] as { _id?: string } | undefined)?._id === "getOrganization" &&
        refetchable(query),
    }),
    refetchMembers(queryClient),
  ]);
}

/**
 * After an administration change, also after an error (the page was probably out of date). The
 * mutation waits for the refetch, so a caller's `onSuccess` (which may open the new group's page)
 * sees the fresh lists, never a not-found page for a moment.
 */
function useSettled() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([refetchAdministration(queryClient), refetchMe(queryClient)]);
  };
}

/** Makes an organization with its first admin (platform admins). `name_taken` is 409. */
export function useCreateOrganization() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async (body: CreateOrganizationRequestInput) => {
      const { data } = await createOrganization({ body, throwOnError: true });
      return data;
    },
    onSettled,
  });
}

/** Changes the name (platform admins) or the contact address of an organization, with a partial patch. */
export function useUpdateOrganization() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({
      organizationId,
      patch,
    }: {
      organizationId: string;
      patch: UpdateOrganizationRequestInput;
    }) => {
      const { data } = await updateOrganization({
        path: { organizationId },
        body: patch,
        throwOnError: true,
      });
      return data;
    },
    onSettled,
  });
}

/** Makes someone, named by email address, an admin of an organization. */
export function useAddOrganizationAdmin() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({
      organizationId,
      email,
    }: { organizationId: string } & AddOrganizationAdminRequestInput) => {
      const { data } = await addOrganizationAdmin({
        path: { organizationId },
        body: { email },
        throwOnError: true,
      });
      return data;
    },
    onSettled,
  });
}

/** Takes the admin role from someone. The last admin stays (`last_organization_admin` is 409). */
export function useRemoveOrganizationAdmin() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({ organizationId, userId }: { organizationId: string; userId: string }) => {
      await removeOrganizationAdmin({ path: { organizationId, userId }, throwOnError: true });
    },
    onSettled,
  });
}

/** Makes a working group in an organization, with its first coordinator named by email address. */
export function useCreateWorkingGroup() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({
      organizationId,
      body,
    }: {
      organizationId: string;
      body: CreateWorkingGroupRequestInput;
    }) => {
      const { data } = await createWorkingGroup({
        path: { organizationId },
        body,
        throwOnError: true,
      });
      return data;
    },
    onSettled,
  });
}

/** Changes the name, the city or whether a working group is active, with a partial patch. */
export function useUpdateWorkingGroup() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({
      workingGroupId,
      patch,
    }: {
      workingGroupId: string;
      patch: UpdateWorkingGroupRequestInput;
    }) => {
      const { data } = await updateWorkingGroup({
        path: { workingGroupId },
        body: patch,
        throwOnError: true,
      });
      return data;
    },
    onSettled,
  });
}

/** Makes a member a coordinator, or a volunteer again. The last coordinator stays (`last_coordinator` is 409). */
export function useSetCoordinator() {
  const onSettled = useSettled();
  return useMutation({
    mutationFn: async ({
      membershipId,
      isCoordinator,
    }: {
      membershipId: string;
      isCoordinator: boolean;
    }) => {
      const { data } = await updateMembership({
        path: { membershipId },
        body: { isCoordinator },
        throwOnError: true,
      });
      return data;
    },
    onSettled,
  });
}

/** Whether the user administers an organization: a platform admin, or an admin of it. For showing buttons only; the API decides. */
export function administersOrganization(me: MeResponse, organizationId: string): boolean {
  return (
    me.user.isPlatformAdmin ||
    me.organizationAdminOf.some((organization) => organization.id === organizationId)
  );
}

/** Whether the user manages a working group (changes it, makes coordinators): a platform admin or an admin of its organization. For showing buttons only. */
export function mayManageWorkingGroup(
  me: MeResponse,
  group: { id: string; organization: { id: string } },
): boolean {
  return administersOrganization(me, group.organization.id);
}

/**
 * Adds people to a working group by email address (one result per address). The mutation waits
 * for the refetch of the member lists and the managed groups, also after an error (a 429 or a
 * group switched off meanwhile): the lists on screen are then fresh.
 */
export function useAddMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workingGroupId,
      emails,
    }: { workingGroupId: string } & AddMembersRequestInput) => {
      const { data } = await addMembers({
        path: { workingGroupId },
        body: { emails },
        throwOnError: true,
      });
      return data;
    },
    onSettled: () => refetchAdministration(queryClient),
  });
}
