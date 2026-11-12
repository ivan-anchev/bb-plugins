import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxPr, Visit } from "../../contract.ts";
import { repoSchema } from "../../github/repo.ts";
import { attentionOf, visitsByPr } from "./attention.ts";

const REPO = repoSchema.parse("ivan-anchev/bb-plugins");
const UPDATED = "2026-11-12T10:00:00Z";

const pr = (fields: Partial<Pick<InboxPr, "repo" | "state" | "ciFailing" | "changesRequested">> = {}): InboxPr => ({
  projectId: "proj_1",
  repo: REPO,
  number: 87,
  title: "Group the sidebar into sections",
  author: "ivan-anchev",
  state: "OPEN",
  updatedAt: UPDATED,
  mergedAt: null,
  baseRefName: "main",
  headRefName: "sidebar-sections",
  ciFailing: false,
  changesRequested: false,
  section: "authored",
  ...fields,
});

const visited = (openedAt: string) => visitsByPr([{ projectId: "proj_1", repo: REPO, number: 87, openedAt: Date.parse(openedAt) } satisfies Visit]);
const BEFORE = visited("2026-11-12T09:00:00Z");
const AFTER = visited("2026-11-12T11:00:00Z");
const NEVER = visitsByPr([]);

test("CI failing outranks changes requested, which outranks new activity", () => {
  assert.equal(attentionOf(pr({ ciFailing: true, changesRequested: true }), "authored", BEFORE), "ci-failing");
  assert.equal(attentionOf(pr({ changesRequested: true }), "authored", BEFORE), "changes-requested");
  assert.equal(attentionOf(pr(), "authored", BEFORE), "new-activity");
});

test("no activity since the reader last opened it: no dot", () => {
  assert.equal(attentionOf(pr(), "authored", AFTER), null);
  assert.equal(attentionOf(pr(), "review", AFTER), null);
});

test("never opened: new only when it asks for the reader's review", () => {
  assert.equal(attentionOf(pr(), "review", NEVER), "new-activity");
  assert.equal(attentionOf(pr(), "authored", NEVER), null);
});

test("a draft carries a dot; a merged or closed PR never does", () => {
  assert.equal(attentionOf(pr({ state: "DRAFT", ciFailing: true }), "authored", BEFORE), "ci-failing");
  assert.equal(attentionOf(pr({ state: "MERGED", ciFailing: true }), "merged", BEFORE), null);
  assert.equal(attentionOf(pr({ state: "CLOSED", changesRequested: true }), "authored", BEFORE), null);
});

test("a visit counts for its own repo and number only", () => {
  const otherRepo = visitsByPr([{ projectId: "proj_1", repo: repoSchema.parse("octo-org/widgets"), number: 87, openedAt: Date.parse("2026-11-12T11:00:00Z") }]);
  assert.equal(attentionOf(pr(), "review", otherRepo), "new-activity");
});

test("a visit saved under a remote spelled in other case clears the dot of GitHub's row", () => {
  const upperRemote = visitsByPr([{ projectId: "proj_1", repo: repoSchema.parse("Octo-Org/Widgets"), number: 87, openedAt: Date.parse("2026-11-12T11:00:00Z") }]);
  assert.equal(attentionOf(pr({ repo: repoSchema.parse("octo-org/widgets") }), "review", upperRemote), null);
});
