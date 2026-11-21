import { isDeepStrictEqual } from "node:util";
import type { AlwaysdataApi, Resource, ResourceKind } from "./api.ts";
import { isReference, type DesiredResource, type ResourceReference } from "./resources.ts";

export type PlannedChange = {
  action: "create" | "update" | "ok" | "conflict";
  kind: ResourceKind;
  /** The identity value, such as the resource's name. */
  identity: string;
  /** Fields to send: all of them on create, only the changed ones on update. */
  fields?: string[];
  /** Why a conflict needs a human. */
  reason?: string;
  /** Id of the existing resource. */
  id?: number;
};

const key = (kind: ResourceKind, identity: { field: string; value: string }) =>
  `${kind} ${identity.field}=${JSON.stringify(identity.value)}`;

const describe = (value: unknown) => (value === undefined ? "nothing" : JSON.stringify(value));

/** Whether a listed field value points at the resource with this id. */
function refersTo(actual: unknown, id: number): boolean {
  if (actual === id) return true;
  return typeof actual === "object" && actual !== null && (actual as { id?: unknown }).id === id;
}

/**
 * Compares the desired resources with what the account holds. Each kind is listed once,
 * and only the desired fields are compared. Changes nothing.
 */
export async function planResources(
  api: AlwaysdataApi,
  desired: readonly DesiredResource[],
  options: { rotatePassword?: boolean } = {},
): Promise<PlannedChange[]> {
  const lists = new Map<ResourceKind, Resource[]>();
  const kinds = new Set<ResourceKind>();
  for (const resource of desired) {
    kinds.add(resource.kind);
    for (const value of Object.values(resource.fields)) {
      if (isReference(value)) kinds.add(value.kind);
    }
  }
  for (const kind of kinds) lists.set(kind, await api.list(kind));

  const find = (kind: ResourceKind, identity: { field: string; value: string }) =>
    (lists.get(kind) ?? []).filter((r) => r[identity.field] === identity.value);
  // Undefined when the referenced resource does not exist yet (or is ambiguous).
  const resolve = (reference: ResourceReference) => {
    const matches = find(reference.kind, reference.identity);
    return matches.length === 1 ? matches[0]?.id : undefined;
  };

  return desired.map((resource): PlannedChange => {
    const base = { kind: resource.kind, identity: resource.identity.value };
    const matches = find(resource.kind, resource.identity);
    if (matches.length === 0) {
      return { ...base, action: "create", fields: Object.keys(resource.fields) };
    }
    const [existing] = matches;
    if (matches.length > 1 || !existing) {
      return {
        ...base,
        action: "conflict",
        reason: `${matches.length} resources have ${resource.identity.field} ${JSON.stringify(resource.identity.value)}; remove all but one by hand`,
      };
    }

    const createOnly = resource.createOnly ?? [];
    const writeOnly = resource.writeOnly ?? [];
    const differs = (field: string) => {
      const wanted = resource.fields[field];
      if (isReference(wanted)) {
        const id = resolve(wanted);
        return id === undefined || !refersTo(existing[field], id);
      }
      return !isDeepStrictEqual(existing[field], wanted);
    };

    const fixed = createOnly.filter(differs);
    if (fixed.length > 0) {
      return {
        ...base,
        id: existing.id,
        action: "conflict",
        reason: fixed
          .map(
            (field) =>
              `${field} is ${describe(existing[field])} but should be ${describe(resource.fields[field])}, and can only be set when the resource is created`,
          )
          .join("; "),
      };
    }

    const changed = Object.keys(resource.fields).filter((field) => {
      if (createOnly.includes(field)) return false;
      if (writeOnly.includes(field)) return options.rotatePassword === true;
      return differs(field);
    });
    return changed.length === 0
      ? { ...base, id: existing.id, action: "ok" }
      : { ...base, id: existing.id, action: "update", fields: changed };
  });
}

/**
 * Carries out a plan from `planResources` for the same desired resources: creates and
 * updates in order. Refuses a plan with a conflict, before changing anything.
 */
export async function applyPlan(
  api: AlwaysdataApi,
  desired: readonly DesiredResource[],
  plan: readonly PlannedChange[],
): Promise<void> {
  const mismatch =
    plan.length !== desired.length ||
    plan.some(
      (change, i) =>
        change.kind !== desired[i]?.kind || change.identity !== desired[i]?.identity.value,
    );
  if (mismatch) throw new Error("The plan does not match the desired resources; plan again");
  const conflicts = plan.filter((change) => change.action === "conflict");
  if (conflicts.length > 0) {
    throw new Error(
      `The plan has ${conflicts.length} conflict(s); nothing was changed. Resolve them by hand first`,
    );
  }

  // Ids of the resources handled so far; references only point backwards in the list.
  const ids = new Map<string, number>();
  const resolveFields = (fields: Record<string, unknown>, names: readonly string[]) =>
    Object.fromEntries(
      names.map((name) => {
        const value = fields[name];
        if (!isReference(value)) return [name, value];
        const id = ids.get(key(value.kind, value.identity));
        if (id === undefined) {
          throw new Error(
            `${name} refers to ${key(value.kind, value.identity)}, which does not come before it`,
          );
        }
        return [name, id];
      }),
    );

  for (const [i, change] of plan.entries()) {
    const resource = desired[i];
    if (!resource) continue;
    const resourceKey = key(resource.kind, resource.identity);
    if (change.action === "create") {
      const body = resolveFields(resource.fields, Object.keys(resource.fields));
      const created = await api.create(resource.kind, body, resource.identity);
      ids.set(resourceKey, created.id);
      continue;
    }
    if (change.id === undefined) throw new Error(`The plan has no id for ${resourceKey}`);
    if (change.action === "update") {
      await api.update(
        resource.kind,
        change.id,
        resolveFields(resource.fields, change.fields ?? []),
      );
    }
    ids.set(resourceKey, change.id);
  }
}
