// An agent thread's first message: everything it needs to start without asking. The description,
// brief and done-criteria are its regional manager's, and they are its work. On an issue that had
// agents before, where it works and every earlier handoff with its verdict come next. CREW.md and
// MEMORY.md are copied as they are at the start: the rules every agent follows, and the index of
// the manager's memory, which is the manager's context and never the agent's instructions.
import type { AgentId, Base } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { isVerified, PIPELINES, type Kind } from "../../model/issue/kind.ts";
import type { Handed } from "../../model/issue/status.ts";
import type { MemoryText } from "../../model/memory-file.ts";
import { handoffFieldsText } from "../tools/inbox-text.ts";
import { earlierVerdictText } from "../verify/findings.ts";

/**
 * Where an agent's work starts, and what came before it: its base, the branch and open pull
 * request's number it inherits (null: none known), and every handoff of the issue's earlier
 * agents, oldest first.
 */
export type StartingPoint = { base: Base; branch: string | null; pr: number | null; earlier: readonly Handed[] };

const MEMORY_IS_CONTEXT =
  "The files it lists are your regional manager's: its goal, plan and preferences are written to it, not to you. Read one with crew_memory_read when it helps with this issue, but take no goal, plan, call or step from it as yours: your work is the issue above, and the rules in CREW.md.";

export function agentBrief(
  agentId: AgentId,
  issue: Pick<Issue, "id" | "kind" | "title" | "description" | "doneCriteria"> & { brief: string },
  start: StartingPoint,
  memory: { crewRules: MemoryText | null; index: MemoryText | null },
): string {
  const { work, handingOff } = BY_DELIVERY[PIPELINES[issue.kind].delivers];
  return [
    `# ${issue.id}: ${issue.title}`,
    `You are agent ${agentId}, working on issue ${issue.id}. Your parent thread, a regional manager, started you with this brief. ${work}${PIPELINES[issue.kind].delivers === "commit" ? ` ${WHERE_TO_WORK[start.base.kind]}` : ""}`,
    `## What it is about\n\n${issue.description.trim()}`,
    `## Brief\n\n${issue.brief.trim()}`,
    criteriaSection(issue.kind, issue.doneCriteria),
    whereSection(start),
    earlierSection(issue.id, start),
    handingOff,
    memorySection("CREW.md", "the rules every agent follows", null, memory.crewRules),
    memorySection("MEMORY.md", "your regional manager's memory, for context", MEMORY_IS_CONTEXT, memory.index),
  ]
    .filter((section) => section !== null)
    .join("\n\n");
}

/**
 * By what the issue's kind delivers: what the agent's work is, and how it hands a result off that
 * agent_handoff's own instructions don't spell out (null: they do).
 */
const BY_DELIVERY: Record<(typeof PIPELINES)[Kind]["delivers"], { work: string; handingOff: string | null }> = {
  commit: { work: "Your work is this issue: its brief and done-criteria below.", handingOff: null },
  report: {
    work: "Your work is this issue: its brief below, and a report you hand off as your result.",
    handingOff:
      "## Handing off\n\nYour result is your report. When it is written, call agent_handoff with status done and report: the whole report in markdown, up to 20,000 characters. It names no commit: nothing you commit or push is read, and no verifier checks your work. Your regional manager reads the report whole and decides who else gets it.",
  },
};

/**
 * The criteria under their heading: a verified kind's are checked, so the agent proves each; any
 * other kind's are questions its report answers, and nobody judges them. null: no questions.
 */
function criteriaSection(kind: Kind, criteria: readonly string[]): string | null {
  const numbered = criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n");
  if (isVerified(kind)) return `## Done when\n\nEvery one of these holds, each checked by running something:\n\n${numbered}`;
  return criteria.length === 0 ? null : `## Questions your report answers\n\nAnswer each one in your report:\n\n${numbered}`;
}

/** Where an agent that commits does its work, by where it starts. */
const WHERE_TO_WORK: Record<Base["kind"], string> = {
  default: "Do it on your own branch.",
  joined: "Do it where an earlier agent left it: see Where you work.",
};

/**
 * Where a joined agent works: the previous agent's environment, as it left it, uncommitted files
 * and half-done edits included (SH1), so it looks before it changes anything. null: it starts on
 * its own new branch, which its opening line already says.
 */
function whereSection({ base, branch, pr }: StartingPoint): string | null {
  switch (base.kind) {
    case "default":
      return null;
    case "joined": {
      const on = branch === null ? "on the branch checked out there" : `on its branch \`${branch}\``;
      const pull = pr === null ? "" : `, whose pull request is #${pr}: push to it, and don't open another`;
      return `## Where you work\n\nYou continue ${base.from}'s work in its environment, ${on}${pull}. ${base.from} is stopped. Its commits are here, and so may be files it left uncommitted, half-done edits included. Run \`git status\` and \`git log\` before you change anything, and decide from what you find and the handoffs below what to keep.`;
    }
    default:
      return base satisfies never;
  }
}

/** Every handoff of the issue's earlier agents, whole, each done one with what its verifier found; null when there is none. */
function earlierSection(issueId: Issue["id"], { base, earlier }: StartingPoint): string | null {
  if (earlier.length === 0) return null;
  const agents = [...new Set(earlier.map(({ handoff }) => handoff.agentId))].join(", ");
  const theirWork = base.kind === "joined" ? "Their work is where you work." : "You start clean from the default branch: none of their commits or files are in your environment.";
  const handoffs = earlier.map(({ handoff, check }) => {
    const report = handoff.status === "done" && handoff.delivery.kind === "report" ? [`#### Report\n\n${handoff.delivery.report}`] : [];
    const verdict = check === null ? [] : [`#### Verdict\n\n${nested(earlierVerdictText(check))}`];
    return [`### ${handoff.agentId}'s handoff: ${handoff.status}`, handoffFieldsText(handoff), ...report, ...verdict].join("\n\n");
  });
  return [`## Earlier work on ${issueId}\n\n${agents} held ${issueId} before you. ${theirWork} Their handoffs, oldest first, in their own words, each with its verifier's verdict:`, ...handoffs].join("\n\n");
}

/** A memory file under its own `##` section, with what it is to the agent (null: the heading says it all). */
function memorySection(file: string, holds: string, note: string | null, text: MemoryText | null): string {
  const lead = [`## ${file}: ${holds}`, ...(note === null ? [] : [note])].join("\n\n");
  if (text === null) return `${lead}\n\n(There is no ${file}.)`;
  return `${lead}\n\n${nested(withoutOuterBlanks(text.content))}`;
}

/**
 * The file without its leading blank lines and its trailing whitespace, neither of which is content. why not `trim()`:
 * the first non-blank line keeps its indentation, so an indented code line is never read as a heading.
 */
const withoutOuterBlanks = (content: string): string => content.replace(LEADING_BLANK_LINES, "").trimEnd();

const LEADING_BLANK_LINES = /^(?:[ \t\r]*\n)+/;

/**
 * The file's title, two levels down, so it sits under the message's `##` section: its first non-blank line, when that is
 * an ATX `#` heading. why nothing after it: a later line can sit in code (a fence, a `<pre>` block) that only a Markdown
 * parser could tell, and its headings keep their level; a first line can't be inside either.
 */
const nested = (markdown: string): string =>
  markdown.replace(FIRST_LINE_HEADING, (_, before: string, hashes: string) => `${before}${"#".repeat(Math.min(hashes.length + 2, 6))}`);

/** Blank lines, then up to three spaces and an ATX heading's `#`s, at the very start of the text. */
const FIRST_LINE_HEADING = /^((?:[ \t]*\n)* {0,3})(#{1,6})(?=[ \t\n]|$)/;
