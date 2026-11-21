import type { RouteObject } from "react-router";
import { expect, test } from "vitest";
import { routes } from "./router";

function collectPaths(list: RouteObject[], parent = ""): string[] {
  return list.flatMap((route) => {
    const path = route.path
      ? `${parent.replace(/\/$/, "")}/${route.path.replace(/^\//, "")}`
      : parent;
    return [...(route.path ? [path] : []), ...collectPaths(route.children ?? [], path)];
  });
}

test("the portal has a home page and a system page", () => {
  expect(collectPaths(routes)).toEqual(expect.arrayContaining(["/system"]));
});

test("no portal route starts with /app or /api", () => {
  for (const path of collectPaths(routes)) expect(path).not.toMatch(/^\/(app|api)(\/|$)/);
});
