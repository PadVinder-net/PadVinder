import { isDeepStrictEqual } from "node:util";
import {
  matchesIdentity,
  type AlwaysdataApi,
  type Identity,
  type Resource,
  type ResourceKind,
} from "./api.ts";
import { mainSshUserIdentity, type DesiredResource } from "./resources.ts";

export type PlannedChange = {
  action: "create" | "update" | "ok" | "conflict";
  kind: ResourceKind;
  /** The identity value, such as the resource's name or a site's address. */
  identity: string;
  /** Fields to send: all of them on create, only the changed ones on update. */
  fields?: string[];
  /**
   * On update, the values of changed `derived` fields, computed from what the server held
   * when planning. Never printed: only `fields` is.
   */
  derivedValues?: Record<string, unknown>;
  /** Why a conflict needs a human. */
  reason?: string;
  /** Id of the existing resource. */
  id?: number;
  /** Create-only fields that the API does not report, so they cannot be checked. */
  unverified?: string[];
};

const key = (kind: ResourceKind, identity: Identity) =>
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

/**
 * The id of the account's main SSH user, the SSH user named exactly like the account. Only
 * reads; throws when there is none or more than one, so provisioning stops before any write.
 */
export async function findMainSshUserId(api: AlwaysdataApi, account: string): Promise<number> {
  const identity = mainSshUserIdentity(account);
  const matches = (await api.list("ssh")).filter((r) => matchesIdentity(r, identity));
  const [user] = matches;
  if (!user) {
    throw new Error(
      `No SSH user named ${identity.value} on the account; the services must run as the account's main SSH user.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} SSH users are named ${identity.value}; expected one, the account's main SSH user, which the services must run as.`,
    );
  }
  return user.id;
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
  for (const kind of new Set(desired.map((resource) => resource.kind))) {
    lists.set(kind, await api.list(kind));
  }

  const find = (kind: ResourceKind, identity: Identity) =>
    (lists.get(kind) ?? []).filter((r) => matchesIdentity(r, identity));

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
    const derived = resource.derived ?? {};
    const wanted = (field: string) => {
      const derive = derived[field];
      return derive ? derive(existing[field]) : resource.fields[field];
    };
    const differs = (field: string) => !sameValue(existing[field], wanted(field));

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
    if (changed.length === 0) return { ...checked, action: "ok" };
    const changedDerived = changed.filter((field) => field in derived);
    return {
      ...checked,
      action: "update",
      fields: changed,
      ...(changedDerived.length > 0
        ? {
            derivedValues: Object.fromEntries(
              changedDerived.map((field) => [field, wanted(field)]),
            ),
          }
        : {}),
    };
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

  const pick = (fields: Record<string, unknown>, names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [name, fields[name]]));

  for (const [i, change] of plan.entries()) {
    const resource = desired[i];
    if (!resource) continue;
    if (change.action === "create") {
      const created = await api.create(resource.kind, resource.fields, resource.identity);
      checkCreateOnlyFields(resource, created, warn);
      continue;
    }
    if (change.id === undefined) {
      throw new Error(`The plan has no id for ${key(resource.kind, resource.identity)}`);
    }
    if (change.action === "update") {
      await api.update(resource.kind, change.id, {
        ...pick(resource.fields, change.fields ?? []),
        ...change.derivedValues,
      });
    }
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
