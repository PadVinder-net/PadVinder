import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi, type Resource } from "./api.ts";
import { applyPlan, planResources } from "./reconcile.ts";
import { desiredResources } from "./resources.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";

const password = "p@ss/w+rd";
const desired = desiredResources("acme", "staging", password);
let fake: FakeAlwaysdata;
let api: AlwaysdataApi;

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey: "test-key",
    account: "acme",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  for (const items of fake.resources.values()) items.length = 0;
});

const writes = () => fake.requests.filter((r) => r.method !== "GET");
const stored = (kind: Parameters<AlwaysdataApi["list"]>[0], field: string, value: string) => {
  const found = fake.resources.get(kind)?.find((r) => r[field] === value);
  if (!found) throw new Error(`no ${kind} with ${field} ${value}`);
  return found;
};

test("an empty account plans six creates in dependency order", async () => {
  const plan = await planResources(api, desired);
  expect(plan.map((c) => [c.action, c.kind, c.identity])).toEqual([
    ["create", "ssh", "acme_deploy"],
    ["create", "database", "acme_staging"],
    ["create", "database/user", "acme_staging"],
    ["create", "site", "padvinder-staging"],
    ["create", "service", "padvinder-api (staging)"],
    ["create", "service", "padvinder-worker (staging)"],
  ]);
  expect(writes()).toEqual([]);
});

test("apply creates the resources and points the services at the SSH user", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const sshUser = stored("ssh", "name", "acme_deploy");
  expect(sshUser).toMatchObject({ can_use_password: false });
  expect(sshUser).not.toHaveProperty("password");
  const apiService = stored("service", "annotation", "padvinder-api (staging)");
  expect(apiService).toMatchObject({
    ssh_user: sshUser.id,
    command:
      "node --env-file=release.env --env-file=/home/acme/padvinder/staging/.env api/dist/main.js",
    working_directory: "padvinder/staging/current",
    environment: "NODEJS_VERSION=24",
  });
  expect(stored("service", "annotation", "padvinder-worker (staging)")).toMatchObject({
    ssh_user: sshUser.id,
    command:
      "node --env-file=release.env --env-file=/home/acme/padvinder/staging/.env worker/dist/main.js",
  });
  expect(stored("database/user", "name", "acme_staging")).toMatchObject({
    password,
    permissions: { acme_staging: "FULL" },
  });
  expect(stored("site", "name", "padvinder-staging")).toMatchObject({
    type: "reverse_proxy",
    addresses: ["staging.padvinder.net"],
    ssl_force: true,
  });
});

test("apply then plan again: everything ok and no further writes", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const count = writes().length;
  expect((await planResources(api, desired)).every((c) => c.action === "ok")).toBe(true);
  await applyPlan(api, desired, await planResources(api, desired));
  expect(writes().length).toBe(count);
});

test("a changed service command becomes an update of only that field", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const worker = stored("service", "annotation", "padvinder-worker (staging)");
  worker.command = "node old.js";
  const plan = await planResources(api, desired);
  expect(plan.filter((c) => c.action !== "ok")).toEqual([
    expect.objectContaining({
      action: "update",
      kind: "service",
      identity: "padvinder-worker (staging)",
      fields: ["command"],
    }),
  ]);
  fake.requests.length = 0;
  await applyPlan(api, desired, plan);
  expect(writes()).toEqual([
    {
      method: "PATCH",
      path: `/v1/service/${worker.id}/`,
      body: {
        command:
          "node --env-file=release.env --env-file=/home/acme/padvinder/staging/.env worker/dist/main.js",
      },
    },
  ]);
});

test("a service with another SSH user is pointed back at the deploy user", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const sshUser = stored("ssh", "name", "acme_deploy");
  const apiService = stored("service", "annotation", "padvinder-api (staging)");
  apiService.ssh_user = 999;
  const plan = await planResources(api, desired);
  expect(plan.filter((c) => c.action !== "ok")).toEqual([
    expect.objectContaining({ action: "update", fields: ["ssh_user"] }),
  ]);
  await applyPlan(api, desired, plan);
  expect(apiService.ssh_user).toBe(sshUser.id);
});

test("a database locale mismatch is a conflict, and apply refuses", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  stored("database", "name", "acme_staging").locale = "en_US.UTF-8";
  stored("service", "annotation", "padvinder-api (staging)").command = "node old.js";
  const plan = await planResources(api, desired);
  const conflict = plan.find((c) => c.action === "conflict");
  expect(conflict).toMatchObject({ kind: "database", identity: "acme_staging" });
  expect(conflict?.reason).toMatch(/locale/);
  fake.requests.length = 0;
  await expect(applyPlan(api, desired, plan)).rejects.toThrow(/conflict/i);
  expect(writes()).toEqual([]);
});

test("two resources with the same identity are a conflict", async () => {
  fake.resources
    .get("ssh")
    ?.push({ id: 101, name: "acme_deploy" }, { id: 102, name: "acme_deploy" });
  const plan = await planResources(api, desired);
  expect(plan[0]).toMatchObject({ action: "conflict", kind: "ssh" });
  expect(plan[0]?.reason).toMatch(/2/);
});

test("the password is not compared, and is only sent with --rotate-password", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const user: Resource = stored("database/user", "name", "acme_staging");
  delete user.password;
  const plan = await planResources(api, desired);
  expect(plan.every((c) => c.action === "ok")).toBe(true);
  fake.requests.length = 0;
  await applyPlan(api, desired, plan);
  expect(writes()).toEqual([]);

  const rotation = await planResources(api, desired, { rotatePassword: true });
  expect(rotation.filter((c) => c.action !== "ok")).toEqual([
    expect.objectContaining({ action: "update", kind: "database/user", fields: ["password"] }),
  ]);
  await applyPlan(api, desired, rotation);
  expect(writes()).toEqual([
    { method: "PATCH", path: `/v1/database/user/${user.id}/`, body: { password } },
  ]);
});

test("apply refuses a plan that does not belong to the desired resources", async () => {
  const plan = await planResources(api, desired);
  await expect(applyPlan(api, desired, plan.slice(1))).rejects.toThrow(/does not match/);
  await expect(
    applyPlan(api, desiredResources("acme", "production", password), plan),
  ).rejects.toThrow(/does not match/);
  expect(writes()).toEqual([]);
});

test("a create-only field stored differently stops apply right after that create", async () => {
  // Stands in for an API that normalizes the locale it was given.
  const normalizing: AlwaysdataApi = {
    ...api,
    create: (kind, body, identity) =>
      api.create(kind, kind === "database" ? { ...body, locale: "C" } : body, identity),
  };
  await expect(applyPlan(normalizing, desired, await planResources(api, desired))).rejects.toThrow(
    /locale "C" instead of "C.UTF-8"/,
  );
  expect(writes().map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /v1/ssh/",
    "POST /v1/database/",
  ]);
});

test("a create-only field the API does not return gives a warning, not a conflict", async () => {
  const warnings: string[] = [];
  const dropping: AlwaysdataApi = {
    ...api,
    create: (kind, body, identity) => {
      const { extensions: _dropped, ...rest } = body;
      return api.create(kind, rest, identity);
    },
  };
  await applyPlan(dropping, desired, await planResources(api, desired), {
    warn: (message) => warnings.push(message),
  });
  expect(warnings).toEqual([
    "Could not verify extensions of new database acme_staging: the API does not report it",
  ]);
  const plan = await planResources(api, desired);
  expect(plan.every((c) => c.action === "ok")).toBe(true);
  expect(plan[1]).toMatchObject({ kind: "database", unverified: ["extensions"] });
});

test("addresses in another order are the same addresses", async () => {
  const site = {
    kind: "site" as const,
    identity: { field: "name", value: "s" },
    fields: { name: "s", addresses: ["a.example", "b.example"] },
  };
  fake.resources.get("site")?.push({ id: 5, name: "s", addresses: ["b.example", "a.example"] });
  expect(await planResources(api, [site])).toEqual([expect.objectContaining({ action: "ok" })]);
  fake.resources.get("site")![0]!.addresses = ["a.example"];
  expect(await planResources(api, [site])).toEqual([
    expect.objectContaining({ action: "update", fields: ["addresses"] }),
  ]);
});
