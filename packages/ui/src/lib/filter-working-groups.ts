import type { WorkingGroupSummary } from "@padvinder/contracts";

/** Lowercase, accents removed, every run of non-letters/digits one space, trimmed. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Keeps the groups whose name, organization or city contains the query. Order unchanged. */
export function filterWorkingGroups(
  groups: WorkingGroupSummary[],
  query: string,
): WorkingGroupSummary[] {
  const folded = foldText(query);
  if (folded === "") return groups;
  return groups.filter((group) =>
    [group.name, group.organization.name, group.city].some((value) =>
      foldText(value).includes(folded),
    ),
  );
}
