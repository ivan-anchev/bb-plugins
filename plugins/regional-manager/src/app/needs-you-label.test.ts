import assert from "node:assert/strict";
import { test } from "node:test";
import { needsYou } from "../model/board/board-groups.ts";
import { needsYouBadge } from "./needs-you-label.ts";

test("the badge counts each issue under Needs you once, and nothing else on the board", () => {
  const board = needsYou([
    { status: "in-progress", needsYou: "Blocked: Needs a staging key" },
    { status: "in-progress", needsYou: null },
    { status: "in-review", needsYou: null },
    { status: "todo", needsYou: null },
  ]);
  assert.equal(board, 1);
  assert.deepEqual(needsYouBadge([board]), { count: 1, tone: "critical", label: "1 issue needs you" });
});

test("the badge sums every listed board, and has nothing to say when nothing waits", () => {
  const flagged = { status: "todo", needsYou: "Target main or release/2?" } as const;
  assert.deepEqual(needsYouBadge([needsYou([flagged, flagged]), needsYou([flagged])]), { count: 3, tone: "critical", label: "3 issues need you" });
  assert.equal(needsYouBadge([needsYou([{ status: "in-progress", needsYou: null }]), 0]), null);
});
