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
  /** Create-only fields that the API does not report, so they cannot be checked. */
  unverified?: string[];
};

const key = (kind: ResourceKind, identity: { field: string; value: string }) =>
  `${kind} ${identity.field}=${JSON.stringify(identity.value)}`;

const describe = (value: unknown) => (value === undefined ? "nothing" : JSON.stringify(value));

const isPrimitive = (value: unknown) => value === null || typeof value !== "object";

/**
 * Whether a field on the server holds the desired value. Lists of plain values (such as a
 * site's addresses) are compared as sets: the API may return them in another order.
 */
export function sameValue(actual: unknown, wanted: unknown): boolean {
  if (
    Array.isArray(actual) &&
    Array.isArray(wanted) &&
    actual.every(isPrimitive) &&
    wanted.every(isPrimitive)
  ) {
    const sort = (values: unknown[]) => values.map((v) => JSON.stringify(v)).sort();
    return isDeepStrictEqual(sort(actual), sort(wanted));
  }
  return isDeepStrictEqual(actual, wanted);
}

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
      return !sameValue(existing[field], wanted);
    };

    // A create-only field the API does not report cannot be checked; see checkCreateOnlyFields.
    const unverified = createOnly.filter((field) => !(field in existing));
    const fixed = createOnly.filter((field) => field in existing && differs(field));
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
    const checked = { ...base, id: existing.id, ...(unverified.length > 0 ? { unverified } : {}) };
    return changed.length === 0
      ? { ...checked, action: "ok" }
      : { ...checked, action: "update", fields: changed };
  });
}

/**
 * Carries out a plan from `planResources` for the same desired resources: creates and
 * updates in order. Refuses a plan with a conflict, before changing anything. After each
 * create it checks the create-only fields of the new resource, and stops at a mismatch.
 */
export async function applyPlan(
  api: AlwaysdataApi,
  desired: readonly DesiredResource[],
  plan: readonly PlannedChange[],
  options: { warn?: (message: string) => void } = {},
): Promise<void> {
  const warn = options.warn ?? (() => {});
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
      checkCreateOnlyFields(resource, created, warn);
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

/**
 * A create-only field that the server stored differently (it ignored or normalized it) cannot
 * be fixed later, so this stops before anything else is created. A field that is absent from
 * the returned resource only gives a warning: the API may simply not echo it (these field
 * names are unverified), and failing on that would block every first run.
 */
function checkCreateOnlyFields(
  resource: DesiredResource,
  created: Resource,
  warn: (message: string) => void,
): void {
  for (const field of resource.createOnly ?? []) {
    const wanted = resource.fields[field];
    if (!(field in created)) {
      warn(
        `Could not verify ${field} of new ${resource.kind} ${resource.identity.value}: the API does not report it`,
      );
    } else if (!sameValue(created[field], wanted)) {
      throw new Error(
        `New ${resource.kind} ${resource.identity.value} has ${field} ${describe(created[field])} instead of ${describe(wanted)}; ${field} can only be set on create, so fix it by hand. Stopped before creating anything else`,
      );
    }
  }
}
