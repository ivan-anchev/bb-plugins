// What the issue and agent tools say to the regional manager. An issue is always named by its id
// and an agent by its id, with a link to its thread, so the manager can both act on them and point
// the user at them; the catch-up's rows, issue_create, issue_update and issue_read also give each issue's link,
// which the manager names it to the user by (model/issue/link).
import { boardGroups, LANE_LABELS, type BoardItem } from "../../model/board/board-groups.ts";
import { decisionsText, type IssueDecision } from "../../model/decision.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import { isVerified, PIPELINES } from "../../model/issue/kind.ts";
import { issueLinkMarkdown } from "../../model/issue/link/issue-link.ts";
import { isReady, type Related, type Relations } from "../../model/issue/relations.ts";
import { headlineText, STATUS_LABELS, type Handed, type IssueView } from "../../model/issue/status.ts";
import { placementName, refOf, type Agent } from "../../model/agent/agent.ts";
import { executionText, type Carried, type StartOutcome, type StopOutcome } from "../agents/agents.ts";
import type { Comment } from "../../model/feed/comment.ts";
import { checkOnRecordInFlight, commentsText, finalCheckText, handoffText, type Lookups } from "../tools/inbox-text.ts";
import { fenced } from "../verify/findings.ts";
import type { FinalCheck } from "../../model/verdict/check.ts";
import { recipientsText, type Withdrawn } from "./quiet.ts";
import type { IssueRead } from "./views/issue-facts.ts";

/** The most of an agent's latest answer issue_read returns. */
const OUTPUT_BUDGET_CHARS = 12_000;

const threadLink = (threadId: string | null): string => (threadId === null ? "no thread" : `@thread:${threadId}`);

/**
 * The board section of a catch-up: every issue in its lane, each sub-issue under its parent's row,
 * with its agent, what blocks it and what it blocks, as the board's row says them, then the ready
 * ones; or why it couldn't be read. A flagged sub-issue is also listed under Needs you, and a
 * canceled one under Canceled, not under its parent, as the board shows them.
 */
export function boardText(reads: readonly IssueRead[] | { error: string }, pluginId: string): string {
  if ("error" in reads) return `## Board\n\nCould not read your agents' threads from bb: ${reads.error}. Call crew_catch_up again before relying on any issue's status.`;
  if (reads.length === 0) return "## Board\n\nNo issues yet. File one with issue_create.";
  const placed = reads.map((read) => ({ ...read, id: read.view.issue.id, parentId: read.view.issue.parentId, status: read.view.status, needsYou: read.view.needsYou }));
  const lanes = boardGroups([], placed).map(({ lane, rows }) => [`### ${LANE_LABELS[lane]} (${rows.length})`, ...rows.flatMap((item) => laneLines(item, pluginId))].join("\n"));
  return ["## Board", ...lanes, readyLine(reads.map(({ view }) => view), pluginId)].join("\n\n");
}

/** A row's lines in its lane: an issue's, each of its sub-issues indented under it; a sub-issue apart from its parent names it. why no decision: catch-up lists them in their own section. */
function laneLines(item: BoardItem<IssueRead>, pluginId: string): string[] {
  switch (item.kind) {
    case "decision":
      return [];
    case "issue":
      return [rowLine(item.issue, pluginId), ...item.subIssues.map((sub) => `  ${rowLine(sub, pluginId)}`)];
    case "flagged-sub-issue":
    case "canceled-sub-issue":
      return [rowLine(item.issue, pluginId)];
    default:
      return item satisfies never;
  }
}

function rowLine({ view, agent, threadId, branch }: IssueRead, pluginId: string): string {
  const { issue } = view;
  const held = view.subIssues !== null ? "parent" : agent === null ? "no agent" : `${agent.id}${agent.ended === null ? "" : ` (${agent.ended.how})`}, ${threadLink(threadId)}`;
  const link = linksOf(pluginId, issue);
  const under = issue.parentId === null ? "" : `, under ${link(issue.parentId)}`;
  return `- ${issue.id} "${issue.title}" (${PIPELINES[issue.kind].label}; ${held}${under}${branch === null ? "" : `, on branch \`${branch}\``}): ${headlineText(view)}${blockedText(view.blockedBy, "; blocked by ", link)}${blockedText(view.blocks, "; blocks ", link)}; link: ${link(issue.id)}`;
}

/** The ready issues (relations.ts isReady), by their links: those an agent can start on without waiting. */
function readyLine(views: readonly IssueView[], pluginId: string): string {
  const ready = views.filter(isReady).map(({ issue }) => linksOf(pluginId, issue)(issue.id));
  return `Ready: ${ready.length === 0 ? "none" : ready.join(", ")} (in Todo, no sub-issues, nothing they or their parent depend on is open, and no question at their cap of failed verifications waits for the user).`;
}

/** The issues as `BBP-2 (Todo), BBP-4 (In progress)`, each named by `name`, after `lead`; nothing when there are none. */
const blockedText = (related: readonly Related[], lead: string, name: NameOf): string => (related.length === 0 ? "" : `${lead}${relatedText(related, name)}`);

const relatedText = (related: readonly Related[], name: NameOf): string => related.map(({ id, status }) => `${name(id)} (${STATUS_LABELS[status]})`).join(", ");

/** How a text names an issue: by its id, or by its link. */
type NameOf = (issueId: IssueId) => string;

/** Names `issue`'s manager's issues by their links, as the manager names them to the user, under the id bb gave the plugin. */
const linksOf = (pluginId: string, { coordinatorId }: Issue): NameOf => (issueId) => issueLinkMarkdown(pluginId, { coordinatorId, issueId });

const byId: NameOf = (issueId) => issueId;

/** What issue_create says it filed, what blocks it as it is filed, and its link. */
export const filedText = (issue: Issue, blockedBy: readonly Related[], pluginId: string): string =>
  `Filed ${issue.id} (${issue.kind})${issue.parentId === null ? "" : ` as a sub-issue of ${linksOf(pluginId, issue)(issue.parentId)}`} in ${STATUS_LABELS[issue.rest]}${blockedText(blockedBy, ", blocked by ", linksOf(pluginId, issue))}.${issue.verifier === null ? "" : ` Its done handoffs are checked on ${executionText(issue.verifier)}.`} Link: ${linksOf(pluginId, issue)(issue.id)}`;

/** What issue_update says it did: anything its change implies, the issues it made ready, by their links, and its own link. */
export function updatedText(issue: Issue, { note, nowReady }: { note: string | null; nowReady: readonly IssueId[] }, pluginId: string): string {
  const link = linksOf(pluginId, issue);
  const ready = nowReady.length === 0 ? null : `Now ready: ${nowReady.map(link).join(", ")}.`;
  return [`Updated ${issue.id}.`, note, ready, `Link: ${link(issue.id)}`].filter((line) => line !== null).join(" ");
}

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
          const { from, head, pr } = carried;
          const opens = pr === null ? "" : ` ${from}'s PR #${pr} stays on its branch; ${agentId} opens its own.`;
          // why a check, and the failure: bb cuts the branch after it answers the spawn, so the ref may have moved by then, and a base it can't resolve fails the thread then (bb-facts P2a).
          const checks = head === null ? `No commit of ${from}'s is on record for ${agentId} to check its branch against.` : `${agentId} checks that commit is on its branch before it changes anything, and hands off blocked if it isn't.`;
          return `${started} ${cutText(carried)}, ${runs}. ${checks} Nothing ${from} left uncommitted comes with it; if bb can't cut that branch, its thread fails and you are woken.${opens} ${earlier} ${ends}`;
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

/** Where a cut agent works, in words: `in a new worktree, on a new branch cut from a1's `origin/x` expecting 4be0a17`. */
function cutText(carried: Extract<Carried, { kind: "cut" }>): string {
  const { from, placement, head } = carried;
  return `in a new ${placementName(placement)}, on a new branch cut from ${from}'s \`${refOf(carried)}\`${head === null ? "" : ` expecting ${head.slice(0, 7)}`}`;
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
  blockedBy.length === 0 ? "" : ` ${issueId} is blocked by ${relatedText(blockedBy, byId)}: its agent started anyway, and has nothing of that work but what its brief names.`;

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

/** What a verifier named on an issue applies to, as the first choice (verifier-model.ts): nothing on a kind nothing verifies. */
export function verifierText(issue: Issue): string {
  if (!isVerified(issue.kind)) return `${issue.id} has no verifier: nothing verifies a ${PIPELINES[issue.kind].label.toLowerCase()} issue.`;
  return issue.verifier === null
    ? `${issue.id}'s verifier is the plugin's pick again.`
    : `${executionText(issue.verifier)} is now ${issue.id}'s first choice of verifier for its done handoffs, and its final check as a parent, from the next one on: each runs on it when bb lists it where the check runs and no agent whose work it checks ran on it. A check already running keeps its own.`;
}

/**
 * An issue whole: its status and why, what blocks it, its plan, its decisions, its relations, the
 * verifier named, each agent with what it runs on, every handoff of every agent with its verdict, a
 * build parent's final checks, oldest first, whether a check on its record is in flight, its
 * comments whole, and its agent's latest answer (null: none).
 */
export function issueText(
  { view, threadId, branch }: IssueRead,
  relations: Relations,
  agents: readonly Agent[],
  record: { handed: readonly Handed[]; finalChecks: readonly FinalCheck[] },
  decisions: readonly IssueDecision[],
  comments: readonly Comment[],
  output: string | null,
  lookups: Pick<Lookups, "agents">,
  pluginId: string,
): string {
  const { issue } = view;
  const answer =
    output === null
      ? "No answer yet."
      : output.length <= OUTPUT_BUDGET_CHARS
        ? output.trim()
        : `${output.slice(0, OUTPUT_BUDGET_CHARS)}\n\n[Cut here: it has ${output.length} characters. Read the rest in its thread.]`;
  return [
    `## ${issue.id}: ${issue.title}`,
    `${PIPELINES[issue.kind].label}. ${sentence(`${STATUS_LABELS[view.status]}: ${headlineText(view)}`)}${view.needsYou === null ? "" : " Needs you."}${blockedText(view.blockedBy, " Blocked by ", linksOf(pluginId, issue))}${view.blockedBy.length === 0 ? "" : "."} Thread: ${threadLink(threadId)}${branch === null ? "" : `, branch \`${branch}\``}. Link: ${linksOf(pluginId, issue)(issue.id)}`,
    ...(checkOnRecordInFlight(record.handed) ? [IN_FLIGHT] : []),
    `### What it is about\n\n${issue.description.trim()}`,
    `### Brief\n\n${issue.brief?.trim() ?? "None yet."}`,
    criteriaText(issue),
    `### Decisions\n\n${decisions.length === 0 ? "None yet. Record one with issue_update's decision." : decisionsText(decisions)}`,
    `### Relations\n\n${relationsText(relations, linksOf(pluginId, issue))}`,
    `### Verifier\n\n${verifierLine(issue)}`,
    `### Agents\n\n${agents.length === 0 ? "None started." : agents.map((agent) => agentLine(agent, threadId)).join("\n")}`,
    `### Its record\n\n${record.handed.length === 0 ? "No handoff yet." : record.handed.map((handed) => `#### ${handed.handoff.agentId}'s handoff\n\n${handoffText(handed, lookups)}`).join("\n\n")}`,
    ...(record.finalChecks.length === 0 ? [] : [`### Its final checks\n\n${record.finalChecks.map((check) => `#### ${new Date(check.at).toISOString()}\n\n${finalCheckText(check, lookups)}`).join("\n\n")}`]),
    `### Comments\n\n${commentsText(comments)}`,
    `### Its agent's latest answer\n\n${answer}`,
  ].join("\n\n");
}

const IN_FLIGHT =
  "A check on its record is in flight: its verdict is still to come or to settle, or it waits for CI (see Its record). Message its agent only once it has settled: a message drops it or cuts across it.";

/** The criteria under their heading: a verified kind's are done-criteria, any other's the questions its report answers. */
function criteriaText({ kind, doneCriteria }: Issue): string {
  const verified = isVerified(kind);
  const numbered = doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n");
  return `### ${verified ? "Done when" : "Questions"}\n\n${doneCriteria.length > 0 ? numbered : verified ? "No criteria yet." : "None."}`;
}

/** Its parent and sub-issues, what it depends on and what it blocks, each named by `name`, with its status. */
function relationsText({ parent, subIssues, dependsOn, blocks }: Relations, name: NameOf): string {
  return [
    `Parent: ${parent === null ? "none" : relatedText([parent], name)}.`,
    `Sub-issues: ${subIssues.length === 0 ? "none" : relatedText(subIssues, name)}.`,
    `Depends on: ${dependsOn.length === 0 ? "nothing" : relatedText(dependsOn, name)}.`,
    `Blocks: ${blocks.length === 0 ? "nothing" : relatedText(blocks, name)}.`,
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
