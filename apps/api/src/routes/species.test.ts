import { auditLogEntries, officialSpeciesIds, species } from "@padvinder/db";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { testEnv } from "../test-env";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

type Headers = Record<string, string>;
const list = (headers: Headers) => ctx.app.inject({ url: "/api/species", headers });
const post = (who: CastLogin | { headers: Headers }, payload: object) =>
  ctx.app.inject({ method: "POST", url: "/api/species", headers: who.headers, payload });
const patch = (who: CastLogin | { headers: Headers }, id: string, payload: object) =>
  ctx.app.inject({ method: "PATCH", url: `/api/species/${id}`, headers: who.headers, payload });

let n = 0;
/** A body with names no other test uses. */
const newBody = (extra: Record<string, unknown> = {}) => {
  n++;
  return {
    dutchName: `testsoort ${n}`,
    scientificName: `Testus nummer${n}`,
    needsVerification: false,
    ...extra,
  };
};

const everyone = {
  platformAdmin: 200,
  organizationAdmin: 200,
  coordinator: 200,
  volunteer: 200,
  volunteerOtherGroup: 200,
  coordinatorOtherOrganization: 200,
  applicant: 200,
  anonymous: 401,
};
const adminsOnly = (ok: number) => ({
  platformAdmin: ok,
  organizationAdmin: 403,
  coordinator: 403,
  volunteer: 403,
  volunteerOtherGroup: 403,
  coordinatorOtherOrganization: 403,
  applicant: 403,
  anonymous: 401,
});

test("every logged-in user reads the list", async () =>
  await expectStatuses(cast, everyone, (headers) => list(headers)));

test("the list holds the official species, also switched-off ones, with exactly five fields", async () => {
  const created = (await post(cast.members.platformAdmin, newBody())).json();
  await patch(cast.members.platformAdmin, created.id, { active: false });

  const res = await list(cast.members.volunteer.headers);
  expect(res.statusCode).toBe(200);
  const rows: { id: string; active: boolean }[] = res.json().species;
  for (const id of Object.values(officialSpeciesIds)) {
    expect(rows.map((row) => row.id)).toContain(id);
  }
  expect(rows.find((row) => row.id === created.id)).toMatchObject({ active: false });
  expect(Object.keys(rows[0]!).sort()).toEqual([
    "active",
    "dutchName",
    "id",
    "needsVerification",
    "scientificName",
  ]);
});

test("only a platform admin creates", async () => {
  await expectStatuses(cast, adminsOnly(201), (headers) => post({ headers }, newBody()));
});

test("only a platform admin changes", async () =>
  await expectStatuses(cast, adminsOnly(200), (headers) =>
    patch({ headers }, officialSpeciesIds.gewonePad, { needsVerification: false }),
  ));

test("a refused create stores nothing", async () => {
  const body = newBody();
  expect((await post(cast.members.organizationAdmin, body)).statusCode).toBe(403);
  const rows = await ctx.t.db.select().from(species).where(eq(species.dutchName, body.dutchName));
  expect(rows).toHaveLength(0);
});

test("a refused change changes nothing", async () => {
  const res = await patch(cast.members.coordinator, officialSpeciesIds.kamsalamander, {
    active: false,
  });
  expect(res.statusCode).toBe(403);
  const [row] = await ctx.t.db
    .select()
    .from(species)
    .where(eq(species.id, officialSpeciesIds.kamsalamander));
  expect(row?.active).toBe(true);
});

test("creating answers 201 with the species, names normalized", async () => {
  const res = await post(cast.members.platformAdmin, {
    dutchName: "  Vuur   salamander ",
    scientificName: "Salamandra  salamandra",
    needsVerification: true,
  });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toEqual({
    id: expect.any(String),
    dutchName: "Vuur salamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
    active: true,
  });
});

test("a change answers 200 with the stored species; the same change again is 200 too", async () => {
  const created = (await post(cast.members.platformAdmin, newBody())).json();
  const first = await patch(cast.members.platformAdmin, created.id, {
    needsVerification: true,
    dutchName: `${created.dutchName} b`,
  });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toEqual({
    ...created,
    needsVerification: true,
    dutchName: `${created.dutchName} b`,
  });
  const again = await patch(cast.members.platformAdmin, created.id, {
    needsVerification: true,
    dutchName: `${created.dutchName} b`,
  });
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(first.json());
});

test("a taken name is 409 name_taken and says which field", async () => {
  const res = await post(cast.members.platformAdmin, {
    dutchName: "Gewone Pad",
    scientificName: "Bufo novus",
    needsVerification: false,
  });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({
    statusCode: 409,
    code: "name_taken",
    issues: [{ path: "dutchName", message: expect.any(String) }],
  });

  const spaced = await post(cast.members.platformAdmin, {
    dutchName: "gewone  pad ",
    scientificName: "Bufo novus",
    needsVerification: false,
  });
  expect(spaced.statusCode).toBe(409);

  const scientific = await post(cast.members.platformAdmin, {
    dutchName: "nieuwe pad",
    scientificName: "bufo BUFO",
    needsVerification: false,
  });
  expect(scientific.statusCode).toBe(409);
  expect(scientific.json()).toMatchObject({
    code: "name_taken",
    issues: [{ path: "scientificName" }],
  });

  const renamed = await patch(cast.members.platformAdmin, officialSpeciesIds.bruineKikker, {
    dutchName: "Gewone pad",
  });
  expect(renamed.statusCode).toBe(409);
  expect(renamed.json()).toMatchObject({ code: "name_taken", issues: [{ path: "dutchName" }] });
});

test("a name of spaces or of 101 characters is 400", async () => {
  for (const dutchName of ["   ", "x".repeat(101)]) {
    const created = await post(cast.members.platformAdmin, newBody({ dutchName }));
    expect(created.statusCode, dutchName).toBe(400);
    expect(created.json()).toMatchObject({ code: "invalid_request" });
    const changed = await patch(cast.members.platformAdmin, officialSpeciesIds.gewonePad, {
      dutchName,
    });
    expect(changed.statusCode, dutchName).toBe(400);
  }
});

test("a name with an @ is 400, never a 500", async () => {
  const created = await post(cast.members.platformAdmin, newBody({ dutchName: "pad@x" }));
  expect(created.statusCode).toBe(400);
  expect(created.json()).toMatchObject({ code: "invalid_request" });
  const changed = await patch(cast.members.platformAdmin, officialSpeciesIds.gewonePad, {
    scientificName: "Bufo@bufo",
  });
  expect(changed.statusCode).toBe(400);
});

test("an empty body, an unknown key or a missing field is 400", async () => {
  const admin = cast.members.platformAdmin;
  expect((await patch(admin, officialSpeciesIds.gewonePad, {})).statusCode).toBe(400);
  expect((await patch(admin, officialSpeciesIds.gewonePad, { color: "red" })).statusCode).toBe(400);
  const { needsVerification: _, ...withoutFlag } = newBody();
  expect((await post(admin, withoutFlag)).statusCode).toBe(400);
  expect((await post(admin, newBody({ active: false }))).statusCode).toBe(400);
});

test("markup in a name is stored as typed", async () => {
  const dutchName = `<i>Bufo</i> x${n++}`;
  const res = await post(cast.members.platformAdmin, newBody({ dutchName }));
  expect(res.statusCode).toBe(201);
  expect(res.json().dutchName).toBe(dutchName);
  const rows = (await list(cast.members.volunteer.headers)).json().species;
  expect(rows.find((row: { id: string }) => row.id === res.json().id).dutchName).toBe(dutchName);
});

test("the audit entry names the platform admin as actor", async () => {
  const admin = cast.members.platformAdmin;
  const created = (await post(admin, newBody())).json();
  await patch(admin, created.id, { needsVerification: true });
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectType, "species"), eq(auditLogEntries.subjectId, created.id)),
    );
  expect(entries.map((entry) => entry.action).sort()).toEqual([
    "species.created",
    "species.updated",
  ]);
  for (const entry of entries) {
    expect(entry).toMatchObject({ actorKind: "user", actorUserId: admin.userId });
  }
});

test("an unknown id is 404; an id that is not a UUID is 400", async () => {
  const unknown = await patch(cast.members.platformAdmin, uuidv7(), { active: false });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json()).toMatchObject({ code: "not_found" });
  const notUuid = await patch(cast.members.platformAdmin, "gewone-pad", { active: false });
  expect(notUuid.statusCode).toBe(400);
  expect(notUuid.json()).toMatchObject({ code: "invalid_request" });
});

test("there is no way to delete a species", async () => {
  const res = await ctx.app.inject({
    method: "DELETE",
    url: `/api/species/${officialSpeciesIds.gewonePad}`,
    headers: cast.members.platformAdmin.headers,
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ code: "not_found" });
  const [row] = await ctx.t.db
    .select()
    .from(species)
    .where(eq(species.id, officialSpeciesIds.gewonePad));
  expect(row).toBeDefined();
});

test("a POST from a foreign Origin is refused", async () => {
  const body = newBody();
  const res = await post(
    { headers: { ...cast.members.platformAdmin.headers, origin: "https://evil.example" } },
    body,
  );
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  const rows = await ctx.t.db.select().from(species).where(eq(species.dutchName, body.dutchName));
  expect(rows).toHaveLength(0);

  const own = await post(
    { headers: { ...cast.members.platformAdmin.headers, origin: testEnv.PUBLIC_ORIGIN } },
    newBody(),
  );
  expect(own.statusCode).toBe(201);
});
