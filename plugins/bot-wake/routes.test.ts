import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoutes, routeFor, routesSettingSchema, targetsOf, type Routes } from "./routes.ts";

const routes = routesFrom(
  JSON.stringify({ sections: { sec_ops: "ops" }, projects: { proj_1: "dev", proj_2: "Ops" } }),
);

test("a section match beats a project match", () => {
  assert.equal(routeFor(routes, { sectionId: "sec_ops", projectId: "proj_1" }), "OPS");
});

test("a thread outside any routed section falls back to its project", () => {
  assert.equal(routeFor(routes, { sectionId: null, projectId: "proj_1" }), "DEV");
  assert.equal(routeFor(routes, { sectionId: "sec_unknown", projectId: "proj_1" }), "DEV");
});

test("unknown section and project ids route nowhere", () => {
  assert.equal(routeFor(routes, { sectionId: "sec_unknown", projectId: "proj_unknown" }), null);
  assert.equal(routeFor(routes, { sectionId: null, projectId: "constructor" }), null);
});

test("target names are upper-cased and listed once", () => {
  assert.deepEqual(targetsOf(routes), ["DEV", "OPS"]);
});

test("either table may be left out", () => {
  const onlyProjects = routesFrom('{"projects": {"proj_1": "dev"}}');
  assert.equal(routeFor(onlyProjects, { sectionId: "sec_1", projectId: "proj_1" }), "DEV");
  assert.deepEqual(targetsOf(routesFrom("{}")), []);
});

test("malformed routes are rejected with the first problem named", () => {
  assert.deepEqual(parseRoutes("not json"), {
    ok: false,
    error: 'routes must be JSON, e.g. {"sections": {}, "projects": {}}',
  });
  assert.deepEqual(parseRoutes('{"sections": {"sec_1": "ops-team"}}'), {
    ok: false,
    error: "sections.sec_1: target names use letters, digits and _ only",
  });
  assert.equal(parseRoutes('{"sections": []}').ok, false);
  assert.equal(parseRoutes('{"section": {}}').ok, false);
});

test("the settings field shows the same problem under it", () => {
  const result = routesSettingSchema["~standard"].validate('{"projects": {"proj_1": "a b"}}');
  assert.ok(!(result instanceof Promise));
  assert.deepEqual(result.issues?.map((issue) => issue.message), [
    "projects.proj_1: target names use letters, digits and _ only",
  ]);
  const valid = routesSettingSchema["~standard"].validate('{"projects": {"proj_1": "ops"}}');
  assert.ok(!(valid instanceof Promise) && valid.issues === undefined);
});

function routesFrom(text: string): Routes {
  const parsed = parseRoutes(text);
  assert.ok(parsed.ok);
  return parsed.routes;
}
