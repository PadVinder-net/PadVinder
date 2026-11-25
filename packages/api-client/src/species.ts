import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSpecies,
  updateSpecies,
  type CreateSpeciesRequestInput,
  type Species,
  type UpdateSpeciesRequestInput,
} from "./generated";
import { listSpeciesOptions, listSpeciesQueryKey } from "./generated/@tanstack/react-query.gen";

/** The species list (every logged-in user may read it; switched-off species are in it too). */
export function useSpecies() {
  return useQuery(listSpeciesOptions());
}

/** Adds a species. Throws the API's error body (`name_taken` is 409). The list is refetched after success. */
export function useCreateSpecies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSpeciesRequestInput): Promise<Species> => {
      const { data } = await createSpecies({ body, throwOnError: true });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listSpeciesQueryKey() }),
  });
}

/** Changes a species with a partial patch and returns it. The list is refetched after success. */
export function useUpdateSpecies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      speciesId,
      patch,
    }: {
      speciesId: string;
      patch: UpdateSpeciesRequestInput;
    }): Promise<Species> => {
      const { data } = await updateSpecies({
        path: { speciesId },
        body: patch,
        throwOnError: true,
      });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listSpeciesQueryKey() }),
  });
}
