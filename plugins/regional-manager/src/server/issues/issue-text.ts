// What the issue and agent tools say to the regional manager. An issue is always named by its id
// and an agent by its id, with a link to its thread, so the manager can both act on them and point
// the user at them.
import { byLane, LANE_LABELS, laneOf } from "../../model/board/board-groups.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import { isVerified, PIPELINES } from "../../model/issue/kind.ts";
import { isReady, type Related, type Relations } from "../../model/issue/relations.ts";
import { STATUS_LABELS, type Handed, type IssueView } from "../../model/issue/status.ts";
import { placementName, type Agent } from "../../model/agent.ts";
import { executionText, recipientsText, type Carried, type StartOutcome, type StopOutcome, type Withdrawn } from "../agents/agents.ts";
import { handoffText, type Lookups } from "../tools/inbox-text.ts";
import { fenced } from "../verify/findings.ts";
import type { IssueRead } from "./views/issue-facts.ts";

/** The most of an agent's latest answer issue_read returns. */
const OUTPUT_BUDGET_CHARS = 12_000;

const threadLink = (threadId: string | null): string => (threadId === null ? "no thread" : `@thread:${threadId}`);

/**
 * The board section of a catch-up: every issue in its lane, each sub-issue under its parent's row,
 * with its agent and what blocks it, then the ready ones; or why it couldn't be read. A flagged
 * sub-issue is also listed under Needs you, as the board shows it.
 */
export function boardText(reads: readonly IssueRead[] | { error: string }): string {
  if ("error" in reads) return `## Board\n\nCould not read your agents' threads from bb: ${reads.error}. Call crew_catch_up again before relying on any issue's status.`;
  if (reads.length === 0) return "## Board\n\nNo issues yet. File one with issue_create.";
  const subIssuesOf = (read: IssueRead): IssueRead[] => reads.filter(({ view }) => view.issue.parentId === read.view.issue.id);
  const rows = reads.flatMap((read) => {
    if (read.view.issue.parentId === null) return [{ lane: laneOf(read.view), read, subIssues: subIssuesOf(read) }];
    return read.view.needsYou === null ? [] : [{ lane: "needs-you" as const, read, subIssues: [] }];
  });
  const lanes = byLane(rows).map(({ lane, rows: inLane }) =>
    [`### ${LANE_LABELS[lane]} (${inLane.length})`, ...inLane.flatMap(({ read, subIssues }) => [rowLine(read), ...subIssues.map((sub) => `  ${rowLine(sub)}`)])].join("\n"),
  );
  return ["## Board", ...lanes, readyLine(reads.map(({ view }) => view))].join("\n\n");
}

function rowLine({ view, agent, threadId, branch }: IssueRead): string {
  const { issue } = view;
  const held = view.subIssues !== null ? "parent" : agent === null ? "no agent" : `${agent.id}${agent.ended === null ? "" : ` (${agent.ended.how})`}, ${threadLink(threadId)}`;
  const under = issue.parentId === null ? "" : `, under ${issue.parentId}`;
  return `- ${issue.id} "${issue.title}" (${PIPELINES[issue.kind].label}; ${held}${under}${branch === null ? "" : `, on branch \`${branch}\``}): ${view.headline}${blockedText(view.blockedBy, "; blocked by ")}`;
}

/** The issues in Todo that nothing blocks: those an agent can start on without waiting. */
function readyLine(views: readonly IssueView[]): string {
  const ready = views.filter(isReady).map(({ issue }) => issue.id);
  return `Ready: ${ready.length === 0 ? "none" : ready.join(", ")} (in Todo, no sub-issues, and nothing they or their parent depend on is open).`;
}

/** The issues as `i2 (Todo), i4 (In progress)`, after `lead`; nothing when there are none. */
const blockedText = (related: readonly Related[], lead: string): string => (related.length === 0 ? "" : `${lead}${relatedText(related)}`);

const relatedText = (related: readonly Related[]): string => related.map(({ id, status }) => `${id} (${STATUS_LABELS[status]})`).join(", ");

/** What issue_create says it filed, and what blocks it as it is filed. */
export const filedText = (issue: Issue, blockedBy: readonly Related[]): string =>
  `Filed ${issue.id} (${issue.kind})${issue.parentId === null ? "" : ` as a sub-issue of ${issue.parentId}`} in ${STATUS_LABELS[issue.rest]}${blockedText(blockedBy, ", blocked by ")}.${issue.verifier === null ? "" : ` Its done handoffs are checked on ${executionText(issue.verifier)}.`}`;

/** What agent_start did. */
export function startText(issueId: Issue["id"], outcome: Exclude<StartOutcome, { kind: "refused" }>): string {
  switch (outcome.kind) {
    case "started": {
      const { agentId, threadId, execution, inherited, blockedBy, after, replaced, withdrawn, carried } = outcome;
      const started = `${replaced === null ? "Started" : `Stopped ${replaced} and started`} ${agentId} on ${issueId} as @thread:${threadId}`;
      const runs = `on ${executionText(execution)}${inherited ? ", your own provider, model and reasoning level" : ""}`;
      const ends = `It ends its work with a handoff, and you are woken when it hands off, fails, waits on the user or stops without one.${startedBlockedText(issueId, blockedBy)}${withdrawnText(withdrawn)}`;
      if (after === null) return `${started}, ${runs}. It works in its own environment on its own branch, and its brief arrived as a message from you. ${ends}`;
      const earlier = `Its first message, from you, holds the issue's plan and every earlier handoff and verdict.${replaced === null ? "" : ` ${replacedText(replaced)}`}`;
      if (carried === null) return `${started}, ${runs}. It starts clean, in its own environment from the default branch. ${earlier} ${ends}`;
      switch (carried.kind) {
        case "joined":
          return `${started} ${joinedText(carried)}, ${runs}. It continues ${carried.from}'s work there: its commits, its uncommitted files and its pull request are ${agentId}'s now. ${earlier} ${ends}`;
        case "cut": {
          const pr = carried.pr === null ? "" : ` ${carried.from}'s PR #${carried.pr} stays on its branch; ${agentId} opens its own.`;
          // why "gets", and the failure: bb cuts the branch after it answers the spawn, and a base it can't resolve fails the thread then (bb-facts P2a).
          return `${started} ${cutText(carried)}, ${runs}. It gets ${carried.from}'s commits, and nothing ${carried.from} left uncommitted; if bb can't cut that branch, its thread fails and you are woken.${pr} ${earlier} ${ends}`;
        }
        default:
          return carried satisfies never;
      }
    }
    case "failed": {
      const { agentId, error, replaced, withdrawn, carried } = outcome;
      const was = replaced === null ? "" : ` ${replaced} was stopped and replaced, and stays so.`;
      return `bb did not start ${agentId}'s thread${carried === null ? "" : ` ${whereFailed(carried)}`}: ${error}.${was} ${issueId} has no agent and rests in Todo: ${retryText(carried)}.${withdrawnText(withdrawn)}`;
    }
    default:
      return outcome satisfies never;
  }
}

/** Where a joined agent works, in words: `in a1's worktree, on its branch `x`, with PR #44`. */
function joinedText({ from, placement, branch, pr }: Extract<Carried, { kind: "joined" }>): string {
  return `in ${from}'s ${placementName(placement)}${branch === null ? "" : `, on its branch \`${branch}\``}${pr === null ? "" : `, with PR #${pr}`}`;
}

/** Where a cut agent works, in words: `in a new worktree, on a new branch cut from a1's `x` (pushed at 4be0a17)`. */
function cutText({ from, placement, branch, pushed }: Extract<Carried, { kind: "cut" }>): string {
  return `in a new ${placementName(placement)}, on a new branch cut from ${from}'s \`${branch}\`${pushed === null ? "" : ` (pushed at ${pushed.slice(0, 7)})`}`;
}

/** Where bb was to start the agent whose thread it refused, in words. */
function whereFailed(carried: Carried): string {
  switch (carried.kind) {
    case "joined":
      return `in ${carried.from}'s environment`;
    case "cut":
      return cutText(carried);
    default:
      return carried satisfies never;
  }
}

/** What to do after bb refused a new agent's thread. */
function retryText(carried: Carried | null): string {
  if (carried === null) return "call agent_start again, or tell the user";
  const clean = `start clean with agent_start and from: "default"`;
  switch (carried.kind) {
    case "joined":
      return `if bb removed ${carried.from}'s environment, ${clean}; otherwise call agent_start again, or tell the user`;
    case "cut":
      return `call agent_start again (without placement, it continues in ${carried.from}'s environment while bb still has it), or ${clean}`;
    default:
      return carried satisfies never;
  }
}

/** What becomes of a replaced agent's thread: the plugin never archives it. */
const replacedText = (replaced: string): string =>
  `${replaced}'s thread stays stopped, not archived, which keeps its environment alive until someone archives it.`;

/**
 * Your messages to the issue's agents that the start took back from bb's queue, which they never
 * got, quoted, each under the agent it was to when they were to more than one ("" when none).
 */
function withdrawnText(withdrawn: readonly Withdrawn[]): string {
  if (withdrawn.length === 0) return "";
  const one = withdrawn.length === 1;
  const to = recipientsText(withdrawn);
  const quoted = withdrawn.map(({ to: agentId, text }) => (to === agentId ? fenced(text) : `To ${agentId}:\n\n${fenced(text)}`));
  return `\n\n${one ? "Your message" : `Your ${withdrawn.length} messages`} to ${to} still waited in bb's queue, so ${one ? "it was" : "they were"} taken back before anything started, and ${to} never got ${one ? "it" : "them"}:\n\n${quoted.join("\n\n")}`;
}

/** What a start on a blocked issue adds: it started anyway, with nothing of what blocks it. */
const startedBlockedText = (issueId: IssueId, blockedBy: readonly Related[]): string =>
  blockedBy.length === 0 ? "" : ` ${issueId} is blocked by ${relatedText(blockedBy)}: its agent started anyway, and has nothing of that work but what its brief names.`;

/** What agent_stop did. */
export function stopText(agent: Agent, outcome: StopOutcome): string {
  switch (outcome.kind) {
    case "stopped":
      return `${agent.id} is stopped${outcome.archived ? " and its thread archived" : ""}; it no longer holds ${agent.issueId}. crew_catch_up shows where ${agent.issueId} stands now.`;
    case "already-ended":
      return `${agent.id} had already ended (${outcome.how}); nothing changed.`;
    case "still-running":
      return `Asked ${agent.id} to stop, but its thread ${outcome.why}, so it still holds ${agent.issueId}. Call agent_stop again shortly.`;
    default:
      return outcome satisfies never;
  }
}

/** What a verifier named on an issue applies to: nothing on a kind nothing verifies. */
export function verifierText(issue: Issue): string {
  if (!isVerified(issue.kind)) return `${issue.id} has no verifier: nothing verifies a ${PIPELINES[issue.kind].label.toLowerCase()} issue.`;
  return issue.verifier === null ? `${issue.id}'s verifier is the plugin's pick again.` : `${issue.id}'s done handoffs are checked on ${executionText(issue.verifier)}, from its next handoff on; a check already running keeps its own.`;
}

/**
 * An issue whole: its status and why, what blocks it, its plan, its relations, the verifier named,
 * each agent with what it runs on, every handoff of every agent with its verdict, and its agent's
 * latest answer (null: none).
 */
export function issueText({ view, threadId, branch }: IssueRead, relations: Relations, agents: readonly Agent[], record: readonly Handed[], output: string | null, lookups: Pick<Lookups, "agent">): string {
  const { issue } = view;
  const answer =
    output === null
      ? "No answer yet."
      : output.length <= OUTPUT_BUDGET_CHARS
        ? output.trim()
        : `${output.slice(0, OUTPUT_BUDGET_CHARS)}\n\n[Cut here: it has ${output.length} characters. Read the rest in its thread.]`;
  return [
    `## ${issue.id}: ${issue.title}`,
    `${PIPELINES[issue.kind].label}. ${sentence(`${STATUS_LABELS[view.status]}: ${view.headline}`)}${view.needsYou === null ? "" : " Needs you."}${blockedText(view.blockedBy, " Blocked by ")}${view.blockedBy.length === 0 ? "" : "."} Thread: ${threadLink(threadId)}${branch === null ? "" : `, branch \`${branch}\``}.`,
    `### What it is about\n\n${issue.description.trim()}`,
    `### Brief\n\n${issue.brief?.trim() ?? "None yet."}`,
    criteriaText(issue),
    `### Relations\n\n${relationsText(relations)}`,
    `### Verifier\n\n${verifierLine(issue)}`,
    `### Agents\n\n${agents.length === 0 ? "None started." : agents.map((agent) => agentLine(agent, threadId)).join("\n")}`,
    `### Its record\n\n${record.length === 0 ? "No handoff yet." : record.map((handed) => `#### ${handed.handoff.agentId}'s handoff\n\n${handoffText(handed, lookups)}`).join("\n\n")}`,
    `### Its agent's latest answer\n\n${answer}`,
  ].join("\n\n");
}

/** The criteria under their heading: a verified kind's are done-criteria, any other's the questions its report answers. */
function criteriaText({ kind, doneCriteria }: Issue): string {
  const verified = isVerified(kind);
  const numbered = doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n");
  return `### ${verified ? "Done when" : "Questions"}\n\n${doneCriteria.length > 0 ? numbered : verified ? "No criteria yet." : "None."}`;
}

/** Its parent and sub-issues, what it depends on and what it blocks, each with its status. */
function relationsText({ parent, subIssues, dependsOn, blocks }: Relations): string {
  return [
    `Parent: ${parent === null ? "none" : relatedText([parent])}.`,
    `Sub-issues: ${subIssues.length === 0 ? "none" : relatedText(subIssues)}.`,
    `Depends on: ${dependsOn.length === 0 ? "nothing" : relatedText(dependsOn)}.`,
    `Blocks: ${blocks.length === 0 ? "nothing" : relatedText(blocks)}.`,
  ].join("\n");
}

/** Who checks its done handoffs. */
function verifierLine({ kind, verifier }: Issue): string {
  if (!isVerified(kind)) return `None: nothing verifies a ${PIPELINES[kind].label.toLowerCase()} issue.`;
  return verifier === null ? "None named: the plugin picks one independent of its agent." : `Named: ${executionText(verifier)}.`;
}

/** The text as a sentence: with a full stop, unless an agent's summary ending it already has one. */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

function agentLine(agent: Agent, liveThreadId: string | null): string {
  const thread = agent.threadId === liveThreadId ? `, ${threadLink(liveThreadId)}` : "";
  const state = agent.ended === null ? "holds it" : `${agent.ended.how}`;
  return `- ${agent.id}, ${state}, on ${executionText(agent.execution)}${thread}`;
}
