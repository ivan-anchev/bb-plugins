import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyRequired, reviewEventsFor } from "./review-events.ts";

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

test("a new review needs a body only to go as a comment, which GitHub refuses without one", () => {
  assert.deepEqual(
    (["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((event) => bodyRequired(event, false)),
    [true, false, false],
  );
});

test("a pending review goes as any event with no body, since its comments say it", () => {
  assert.deepEqual(
    (["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((event) => bodyRequired(event, true)),
    [false, false, false],
  );
});
