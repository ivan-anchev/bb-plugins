import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routeSubPath, type Route } from "./routes.ts";

const parseCases: [subPath: string, route: Route][] = [
  ["", { kind: "root" }],
  ["/", { kind: "root" }],
  ["proj_abc", { kind: "project", projectId: "proj_abc" }],
  ["proj_abc/", { kind: "project", projectId: "proj_abc" }],
  ["proj_abc/42", { kind: "pr", projectId: "proj_abc", number: 42 }],
  ["/proj_abc/42/", { kind: "pr", projectId: "proj_abc", number: 42 }],
  ["proj%20one/7", { kind: "pr", projectId: "proj one", number: 7 }],
  ["proj%2525/7", { kind: "pr", projectId: "proj%25", number: 7 }],
  ["proj_abc/0", { kind: "project", projectId: "proj_abc" }],
  ["proj_abc/1.5", { kind: "project", projectId: "proj_abc" }],
  ["proj_abc/abc", { kind: "project", projectId: "proj_abc" }],
];

for (const [subPath, route] of parseCases) {
  test(`parseRoute(${JSON.stringify(subPath)})`, () => {
    assert.deepEqual(parseRoute(subPath), route);
  });
}

test("routeSubPath writes unencoded segments", () => {
  assert.equal(routeSubPath({ kind: "project", projectId: "proj one" }), "proj one");
  assert.equal(routeSubPath({ kind: "pr", projectId: "proj_abc", number: 42 }), "proj_abc/42");
});
