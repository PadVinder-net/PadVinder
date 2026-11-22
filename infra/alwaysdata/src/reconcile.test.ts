import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, matchesIdentity, type AlwaysdataApi, type Resource } from "./api.ts";
import { applyPlan, findMainSshUserId, planResources } from "./reconcile.ts";
import { databaseUserPermissions, desiredResources, referencedId } from "./resources.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";

const password = "p@ss/w+rd";
const mainSshUserId = 7;
const desired = desiredResources("acme", "staging", { databasePassword: password, mainSshUserId });
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
  const found = fake.resources.get(kind)?.find((r) => matchesIdentity(r, { field, value }));
  if (!found) throw new Error(`no ${kind} with ${field} ${value}`);
  return found;
};

test("an empty account plans five creates in order, and no SSH user", async () => {
  const plan = await planResources(api, desired);
  expect(plan.map((c) => [c.action, c.kind, c.identity])).toEqual([
    ["create", "database", "acme_staging"],
    ["create", "database/user", "acme_staging"],
    ["create", "site", "staging.padvinder.net/"],
    ["create", "service", "padvinder-api (staging)"],
    ["create", "service", "padvinder-worker (staging)"],
  ]);
  expect(writes()).toEqual([]);
});

test("apply creates the resources; the services run as the main SSH user", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  // The SSH user is never created or changed.
  expect(writes().some((r) => r.path.startsWith("/v1/ssh/"))).toBe(false);
  const apiService = stored("service", "annotation", "padvinder-api (staging)");
  expect(apiService).toMatchObject({
    command: "node --env-file=release.env --env-file=../../.env api/dist/main.js",
    working_directory: "padvinder/staging/current",
    environment: "NODEJS_VERSION=24",
    ssh_user: mainSshUserId,
  });
  const workerService = stored("service", "annotation", "padvinder-worker (staging)");
  expect(workerService).toMatchObject({
    command: "node --env-file=release.env --env-file=../../.env worker/dist/main.js",
    ssh_user: mainSshUserId,
  });
  expect(stored("database/user", "name", "acme_staging")).toMatchObject({
    password,
    permissions: { acme_staging: "FULL" },
  });
  const site = stored("site", "addresses", "staging.padvinder.net/");
  expect(site).toMatchObject({
    type: "reverse_proxy",
    addresses: ["staging.padvinder.net/"],
    ssl_force: true,
    url: "http://services-acme.alwaysdata.net:8301",
  });
  // The API does not keep a site's name, so none is sent.
  const sitePost = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/site/");
  expect(sitePost?.body).not.toHaveProperty("name");
  // The API has no encoding field.
  const databasePost = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/database/");
  expect(databasePost?.body).toEqual({
    name: "acme_staging",
    type: "POSTGRESQL",
    locale: "C.UTF-8",
    extensions: ["postgis"],
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
        command: "node --env-file=release.env --env-file=../../.env worker/dist/main.js",
      },
    },
  ]);
});

test("a service with another ssh_user becomes an update of only that field", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const service = stored("service", "annotation", "padvinder-api (staging)");
  service.ssh_user = 999;
  const plan = await planResources(api, desired);
  expect(plan.filter((c) => c.action !== "ok")).toEqual([
    expect.objectContaining({
      action: "update",
      kind: "service",
      identity: "padvinder-api (staging)",
      fields: ["ssh_user"],
    }),
  ]);
  fake.requests.length = 0;
  await applyPlan(api, desired, plan);
  expect(writes()).toEqual([
    { method: "PATCH", path: `/v1/service/${service.id}/`, body: { ssh_user: mainSshUserId } },
  ]);
  expect((await planResources(api, desired)).every((c) => c.action === "ok")).toBe(true);
});

test("a service's ssh_user shown as an object or href of the main user is ok", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const service = stored("service", "annotation", "padvinder-api (staging)");
  for (const shown of [
    { id: mainSshUserId, name: "acme" },
    { href: `/v1/ssh/${mainSshUserId}/` },
    `https://api.alwaysdata.com/v1/ssh/${mainSshUserId}/`,
  ]) {
    service.ssh_user = shown;
    expect((await planResources(api, desired)).every((c) => c.action === "ok")).toBe(true);
  }
  service.ssh_user = { id: 999 };
  expect((await planResources(api, desired)).find((c) => c.action !== "ok")).toMatchObject({
    action: "update",
    fields: ["ssh_user"],
    derivedValues: { ssh_user: mainSshUserId },
  });
});

test("referencedId reads an id, an object with id or href, or an href", () => {
  expect(referencedId(12)).toBe(12);
  expect(referencedId({ id: 12, name: "x" })).toBe(12);
  expect(referencedId({ href: "/v1/ssh/12/" })).toBe(12);
  expect(referencedId("/v1/ssh/12/")).toBe(12);
  expect(referencedId("https://api.alwaysdata.com/v1/ssh/12")).toBe(12);
  for (const other of [undefined, null, "", "12x/", 1.5, [12], {}, { id: "12" }, true]) {
    expect(referencedId(other)).toBeUndefined();
  }
});

test("findMainSshUserId finds the SSH user named exactly like the account", async () => {
  fake.resources
    .get("ssh")
    ?.push({ id: 3, name: "acme_other" }, { id: 4, name: "acme" }, { id: 5, name: "ACME" });
  expect(await findMainSshUserId(api, "acme")).toBe(4);
  expect(writes()).toEqual([]);
});

test("findMainSshUserId fails without the main SSH user, or with two", async () => {
  fake.resources.get("ssh")?.push({ id: 3, name: "acme_deploy" });
  await expect(findMainSshUserId(api, "acme")).rejects.toThrow(
    "No SSH user named acme on the account; the services must run as the account's main SSH user.",
  );
  fake.resources.get("ssh")?.push({ id: 4, name: "acme" }, { id: 5, name: "acme" });
  await expect(findMainSshUserId(api, "acme")).rejects.toThrow(/2 SSH users are named acme/);
  expect(writes()).toEqual([]);
});

test("the fake refuses a service without ssh_user, as the real API does", async () => {
  await expect(
    api.create("service", { annotation: "x" }, { field: "annotation", value: "x" }),
  ).rejects.toThrow(/failed with 400.*ssh_user.*obligatoire/);
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
    .get("database")
    ?.push({ id: 101, name: "acme_staging" }, { id: 102, name: "acme_staging" });
  const plan = await planResources(api, desired);
  expect(plan[0]).toMatchObject({ action: "conflict", kind: "database" });
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
    applyPlan(
      api,
      desiredResources("acme", "production", { databasePassword: password, mainSshUserId }),
      plan,
    ),
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
  expect(writes().map((r) => `${r.method} ${r.path}`)).toEqual(["POST /v1/database/"]);
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
  expect(plan[0]).toMatchObject({ kind: "database", unverified: ["extensions"] });
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

test("a database user with rights on another database gets NONE there", async () => {
  fake.resources
    .get("database")
    ?.push({ id: 1, name: "acme_production" }, { id: 2, name: "acme_staging" });
  fake.resources.get("database/user")?.push({
    id: 3,
    name: "acme_staging",
    type: "POSTGRESQL",
    permissions: { acme_production: "FULL", acme_staging: "FULL" },
  });
  const plan = await planResources(api, desired.slice(0, 2));
  expect(plan).toEqual([
    expect.objectContaining({ action: "ok", kind: "database" }),
    expect.objectContaining({ action: "update", kind: "database/user", fields: ["permissions"] }),
  ]);
  fake.requests.length = 0;
  await applyPlan(api, desired.slice(0, 2), plan);
  expect(writes()).toEqual([
    {
      method: "PATCH",
      path: "/v1/database/user/3/",
      body: { permissions: { acme_production: "NONE", acme_staging: "FULL" } },
    },
  ]);
  expect((await planResources(api, desired.slice(0, 2))).map((c) => c.action)).toEqual([
    "ok",
    "ok",
  ]);
});

test("a database user without rights on its own database gets FULL there", async () => {
  fake.resources
    .get("database")
    ?.push({ id: 1, name: "acme_production" }, { id: 2, name: "acme_staging" });
  // The fake lists both databases with NONE.
  fake.resources.get("database/user")?.push({ id: 3, name: "acme_staging", permissions: {} });
  const plan = await planResources(api, desired.slice(1, 2));
  expect(plan).toEqual([expect.objectContaining({ action: "update", fields: ["permissions"] })]);
  fake.requests.length = 0;
  await applyPlan(api, desired.slice(1, 2), plan);
  expect(writes()[0]?.body).toEqual({
    permissions: { acme_production: "NONE", acme_staging: "FULL" },
  });
});

test("a database user with FULL on its own database and NONE elsewhere is ok", async () => {
  fake.resources
    .get("database")
    ?.push({ id: 1, name: "acme_production" }, { id: 2, name: "acme_staging" });
  fake.resources.get("database/user")?.push({
    id: 3,
    name: "acme_staging",
    type: "POSTGRESQL",
    permissions: { acme_production: "NONE", acme_staging: "FULL" },
  });
  expect(await planResources(api, desired.slice(1, 2))).toEqual([
    expect.objectContaining({ action: "ok", kind: "database/user" }),
  ]);
});

test("databaseUserPermissions: FULL on its own database, NONE on every other listed one", () => {
  expect(databaseUserPermissions("a_staging", undefined)).toEqual({ a_staging: "FULL" });
  expect(databaseUserPermissions("a_staging", { a_production: "FULL", a_staging: "NONE" })).toEqual(
    { a_production: "NONE", a_staging: "FULL" },
  );
  expect(databaseUserPermissions("a_staging", { a_production: "READ" })).toEqual({
    a_production: "NONE",
    a_staging: "FULL",
  });
});

test("the account as found on 22 November 2026: only the services are created", async () => {
  // The database and its user exist, the site exists under a name the API chose, and there
  // are no services. Production's site and database are there too, and the main SSH user.
  fake.resources.get("ssh")?.push({ id: 40, name: "acme" });
  const found = desiredResources("acme", "staging", {
    databasePassword: password,
    mainSshUserId: await findMainSshUserId(api, "acme"),
  });
  fake.resources.get("database")?.push(
    {
      id: 10,
      name: "acme_production",
      type: "POSTGRESQL",
      locale: "C.UTF-8",
      extensions: ["postgis"],
    },
    {
      id: 11,
      name: "acme_staging",
      type: "POSTGRESQL",
      locale: "C.UTF-8",
      extensions: ["postgis"],
      permissions: { acme_staging: "FULL" },
    },
  );
  fake.resources.get("database/user")?.push({
    id: 20,
    name: "acme_staging",
    type: "POSTGRESQL",
    permissions: { acme_production: "NONE", acme_staging: "FULL" },
  });
  fake.resources.get("site")?.push(
    {
      id: 30,
      name: "",
      type: "reverse_proxy",
      addresses: ["padvinder.net/"],
      ssl_force: true,
      url: "http://services-acme.alwaysdata.net:8300",
    },
    {
      id: 31,
      name: "",
      type: "reverse_proxy",
      addresses: ["staging.padvinder.net/"],
      ssl_force: true,
      url: "http://services-acme.alwaysdata.net:8301",
    },
  );

  const plan = await planResources(api, found);
  expect(plan.map((c) => [c.action, c.kind, c.identity, c.id])).toEqual([
    ["ok", "database", "acme_staging", 11],
    ["ok", "database/user", "acme_staging", 20],
    ["ok", "site", "staging.padvinder.net/", 31],
    ["create", "service", "padvinder-api (staging)", undefined],
    ["create", "service", "padvinder-worker (staging)", undefined],
  ]);
  await applyPlan(api, found, plan);
  // Each service names the main SSH user: the real API refused them without it.
  expect(writes().map((r) => [`${r.method} ${r.path}`, (r.body as Resource).ssh_user])).toEqual([
    ["POST /v1/service/", 40],
    ["POST /v1/service/", 40],
  ]);
  expect((await planResources(api, found)).every((c) => c.action === "ok")).toBe(true);
});

test("a site with differing managed fields is updated, never created again", async () => {
  fake.resources.get("site")?.push({
    id: 31,
    name: "something else",
    type: "reverse_proxy",
    addresses: ["staging.padvinder.net/"],
    ssl_force: false,
    url: "http://services-acme.alwaysdata.net:8301",
  });
  const plan = await planResources(api, desired);
  expect(plan[2]).toMatchObject({
    action: "update",
    kind: "site",
    identity: "staging.padvinder.net/",
    id: 31,
    fields: ["ssl_force"],
  });
});
