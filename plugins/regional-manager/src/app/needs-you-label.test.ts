import assert from "node:assert/strict";
import { test } from "node:test";
import { needsYou } from "../model/board/board-groups.ts";
import { decisionIdSchema, type Decision } from "../model/decision.ts";
import { issueIdSchema } from "../model/issue/issue.ts";

const id = issueIdSchema.parse("WEB-1");
import { needsYouBadge } from "./needs-you-label.ts";

const decision = (id: string, answered: boolean): Decision => ({
  id: decisionIdSchema.parse(id),
  issueId: null,
  question: "Which zone first?",
  options: [],
  askedAt: 1_000,
  cap: null,
  answer: answered ? { text: "eu-west", at: 2_000 } : null,
});

test("the badge counts each open decision and each flagged issue once, and nothing else on the board", () => {
  const board = needsYou(
    [decision("d1", false), decision("d2", true)],
    [
      { id, status: "in-progress", needsYou: "Blocked: Needs a staging key" },
      { id, status: "in-progress", needsYou: null },
      { id, status: "in-review", needsYou: null },
      { id, status: "todo", needsYou: null },
    ],
  );
  assert.deepEqual(board, { decisions: 1, issues: 1 });
  assert.deepEqual(needsYouBadge([board]), { count: 2, tone: "critical", label: "2 need you: 1 decision, 1 issue" });
});

test("the badge sums every listed board, and has nothing to say when nothing waits", () => {
  const flagged = { id, status: "todo", needsYou: "Waiting on your answer to its decision" } as const;
  const boards = [needsYou([], [flagged, flagged]), needsYou([decision("d1", false)], [])];
  assert.deepEqual(needsYouBadge(boards), { count: 3, tone: "critical", label: "3 need you: 1 decision, 2 issues" });
  assert.equal(needsYouBadge([needsYou([decision("d1", true)], [{ id, status: "in-progress", needsYou: null }])]), null);
});
