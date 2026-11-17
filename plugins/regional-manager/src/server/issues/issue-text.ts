// What the issue and agent tools say to the regional manager. An issue is always named by its id
// and an agent by its id, with a link to its thread, so the manager can both act on them and point
// the user at them.
import { byLane, LANE_LABELS, laneOf } from "../../model/board/board-groups.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { PIPELINES } from "../../model/issue/kind.ts";
import { STATUS_LABELS, type Handed } from "../../model/issue/status.ts";
import type { Agent } from "../../model/agent.ts";
import { executionText, type StartOutcome, type StopOutcome } from "../agents/agents.ts";
import { handoffText, type Lookups } from "../tools/inbox-text.ts";
import type { IssueRead } from "./issue-facts.ts";

/** The most of an agent's latest answer issue_read returns. */
const OUTPUT_BUDGET_CHARS = 12_000;

const threadLink = (threadId: string | null): string => (threadId === null ? "no thread" : `@thread:${threadId}`);

/** The board section of a catch-up: every issue in its lane, with its agent, or why it couldn't be read. */
export function boardText(reads: readonly IssueRead[] | { error: string }): string {
  if ("error" in reads) return `## Board\n\nCould not read your agents' threads from bb: ${reads.error}. Call crew_catch_up again before relying on any issue's status.`;
  if (reads.length === 0) return "## Board\n\nNo issues yet. File one with issue_create.";
  const lanes = byLane(reads.map((read) => ({ lane: laneOf(read.view), read }))).map(({ lane, rows }) =>
    [`### ${LANE_LABELS[lane]} (${rows.length})`, ...rows.map(({ read }) => rowLine(read))].join("\n"),
  );
  return ["## Board", ...lanes].join("\n\n");
}

function rowLine({ view, agent, threadId, branch }: IssueRead): string {
  const { issue } = view;
  const held = agent === null ? "no agent" : `${agent.id}${agent.ended === null ? "" : ` (${agent.ended.how})`}, ${threadLink(threadId)}`;
  return `- ${issue.id} "${issue.title}" (${PIPELINES[issue.kind].label}; ${held}${branch === null ? "" : `, on branch \`${branch}\``}): ${view.headline}`;
}

/** What issue_create says it filed. */
export const filedText = (issue: Issue): string =>
  `Filed ${issue.id} (${issue.kind}) in ${STATUS_LABELS[issue.rest]}.${issue.verifier === null ? "" : ` Its done handoffs are checked on ${executionText(issue.verifier)}.`}`;

/** What agent_start did. */
export function startText(issueId: Issue["id"], outcome: Exclude<StartOutcome, { kind: "refused" }>): string {
  switch (outcome.kind) {
    case "started":
      return `Started ${outcome.agentId} on ${issueId} as @thread:${outcome.threadId}, on ${executionText(outcome.execution)}${outcome.inherited ? ", your own provider, model and reasoning level" : ""}. It works in its own environment on its own branch, and its brief arrived as a message from you. It ends its work with a handoff, and you are woken when it hands off, fails, waits on the user or stops without one.`;
    case "failed":
      return `bb did not start ${outcome.agentId}'s thread: ${outcome.error}. ${issueId} has no agent and rests in Todo: call agent_start again, or tell the user.`;
    default:
      return outcome satisfies never;
  }
}

/** What agent_stop did. */
export function stopText(agent: Agent, outcome: StopOutcome): string {
  switch (outcome.kind) {
    case "stopped":
      return `${agent.id} is stopped${outcome.archived ? " and its thread archived" : ""}; it no longer holds ${agent.issueId}. crew_catch_up shows where ${agent.issueId} stands now.`;
    case "already-ended":
      return `${agent.id} had already ended (${outcome.how}); nothing changed.`;
    case "still-running":
      return `Asked ${agent.id} to stop, but its thread is still ${outcome.status}, so it still holds ${agent.issueId}. Call agent_stop again shortly.`;
    default:
      return outcome satisfies never;
  }
}

/** What a verifier named on an issue applies to. */
export const verifierText = (issue: Issue): string =>
  issue.verifier === null ? `${issue.id}'s verifier is the plugin's pick again.` : `${issue.id}'s done handoffs are checked on ${executionText(issue.verifier)}, from its next handoff on; a check already running keeps its own.`;

/**
 * An issue whole: its status and why, its plan, the verifier named, each agent with what it runs
 * on, every handoff of every agent with its verdict, and its agent's latest answer (null: none).
 */
export function issueText({ view, threadId, branch }: IssueRead, agents: readonly Agent[], record: readonly Handed[], output: string | null, lookups: Pick<Lookups, "agent">): string {
  const { issue } = view;
  const answer =
    output === null
      ? "No answer yet."
      : output.length <= OUTPUT_BUDGET_CHARS
        ? output.trim()
        : `${output.slice(0, OUTPUT_BUDGET_CHARS)}\n\n[Cut here: it has ${output.length} characters. Read the rest in its thread.]`;
  return [
    `## ${issue.id}: ${issue.title}`,
    `${PIPELINES[issue.kind].label}. ${sentence(`${STATUS_LABELS[view.status]}: ${view.headline}`)}${view.needsYou === null ? "" : " Needs you."} Thread: ${threadLink(threadId)}${branch === null ? "" : `, branch \`${branch}\``}.`,
    `### What it is about\n\n${issue.description.trim()}`,
    `### Brief\n\n${issue.brief?.trim() ?? "None yet."}`,
    `### Done when\n\n${issue.doneCriteria.length === 0 ? "No criteria yet." : issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    `### Verifier\n\n${issue.verifier === null ? "None named: the plugin picks one independent of its agent." : `Named: ${executionText(issue.verifier)}.`}`,
    `### Agents\n\n${agents.length === 0 ? "None started." : agents.map((agent) => agentLine(agent, threadId)).join("\n")}`,
    `### Its record\n\n${record.length === 0 ? "No handoff yet." : record.map((handed) => `#### ${handed.handoff.agentId}'s handoff\n\n${handoffText(handed, lookups)}`).join("\n\n")}`,
    `### Its agent's latest answer\n\n${answer}`,
  ].join("\n\n");
}

/** The text as a sentence: with a full stop, unless an agent's summary ending it already has one. */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

function agentLine(agent: Agent, liveThreadId: string | null): string {
  const thread = agent.threadId === liveThreadId ? `, ${threadLink(liveThreadId)}` : "";
  const state = agent.ended === null ? "holds it" : `${agent.ended.how}`;
  return `- ${agent.id}, ${state}, on ${executionText(agent.execution)}${thread}`;
}
