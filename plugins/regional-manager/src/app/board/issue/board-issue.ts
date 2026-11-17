// What the board draws of an issue: its row, and the detail it opens to. The names follow the
// board's read (an issue row: kind, status, needsYou, headline, agent, pr…), so a row read from the
// server is passed as it is. Relations, "blocked by" and sub-issues are part of the shape now and
// empty until the server fills them; each draws only when it has something to say.
import type { AgentId, EndedHow } from "../../../model/agent.ts";
import type { NextHandoff } from "../../../model/handoff.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { Kind } from "../../../model/issue/kind.ts";
import type { IssueStatus } from "../../../model/issue/status.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import type { Verdict } from "../../../model/verdict/verdict.ts";

/** One issue's row. `needsYou`: why it waits on the user (null: it doesn't), which lifts it into Needs you. */
export type BoardIssue = {
  id: IssueId;
  kind: Kind;
  title: string;
  status: IssueStatus;
  needsYou: string | null;
  headline: string;
  /** Its agent now (null: none); `threadId` null until bb confirms the thread. */
  agent: { id: AgentId; threadId: string | null } | null;
  pr: PrSnapshot | null;
  /** A sub-issue's parent: it is drawn indented under its parent's row. */
  parentId: IssueId | null;
  /** Open dependencies. */
  blockedBy: readonly IssueId[];
  /** A parent's sub-issues done, of all (null: it has none). */
  subIssues: { done: number; total: number } | null;
};

/** An issue opened in place. No brief: that is the agent's, not the user's. */
export type IssueDetailData = {
  kind: Kind;
  description: string;
  doneCriteria: readonly string[];
  relations: Relations;
  /** Every agent that held it, oldest first. */
  record: readonly AgentRecord[];
};

export type Relations = { parentId: IssueId | null; subIssues: readonly IssueId[]; dependsOn: readonly IssueId[]; blocks: readonly IssueId[] };

/** One agent's time on the issue: how it ended (null: it holds it now), and its handoffs, oldest first. */
export type AgentRecord = { agent: { id: AgentId; threadId: string | null; ended: EndedHow | null }; handoffs: readonly HandedOff[] };

/** A handoff as the agent wrote it, and the verdict on it (null: none was asked for, as for a blocked handoff). */
export type HandedOff = Pick<NextHandoff, "id" | "at" | "status" | "summary" | "did" | "evidence" | "concerns" | "deviations" | "findings"> & { verdict: Verdict | null };
