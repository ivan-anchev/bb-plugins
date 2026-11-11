import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewEventsFor } from "./review-events.ts";

test("a reviewer submits their review as a comment, an approval or a request for changes", () => {
  assert.deepEqual(
    reviewEventsFor(false).map((option) => option.event),
    ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
  );
});

test("the PR's author submits theirs only as a comment, as GitHub refuses the others on their own PR", () => {
  assert.deepEqual(
    reviewEventsFor(true).map((option) => option.event),
    ["COMMENT"],
  );
});
