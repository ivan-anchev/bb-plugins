import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFailure, parseMergedPrs, searchArgs } from "./github.ts";

test("parses every slurped page into merge times and lines changed", () => {
  const page = (mergedAt: string, additions: number, deletions: number) => ({
    data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ mergedAt, additions, deletions }] } },
  });
  const prs = parseMergedPrs(JSON.stringify([page("2026-11-12T17:49:42Z", 753, 77), page("2026-05-26T08:13:02Z", 0, 895)]));
  assert.deepEqual(prs, [
    { mergedAt: Date.parse("2026-11-12T17:49:42Z"), lines: 830 },
    { mergedAt: Date.parse("2026-05-26T08:13:02Z"), lines: 895 },
  ]);
});

test("searches the gh user's merged PRs since the date", () => {
  assert.ok(searchArgs("2026-05-11").includes("q=is:pr is:merged author:@me merged:>=2026-05-11"));
});

test("names a missing gh apart from every other failure", () => {
  assert.match(describeFailure({ code: "ENOENT" }), /Install the GitHub CLI/);
  assert.match(describeFailure({ code: 1, stderr: "HTTP 401" }), /signed in/);
});
