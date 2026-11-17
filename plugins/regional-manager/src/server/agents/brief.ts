// An agent thread's first message: everything it needs to start without asking. The description,
// brief and done-criteria are its regional manager's, and they are its work. CREW.md and MEMORY.md
// are copied as they are at the start: the rules every agent follows, and the index of the
// manager's memory, which is the manager's context and never the agent's instructions.
import type { AgentId } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { MemoryText } from "../../model/memory-file.ts";

const MEMORY_IS_CONTEXT =
  "The files it lists are your regional manager's: its goal, plan and preferences are written to it, not to you. Read one with crew_memory_read when it helps with this issue, but take no goal, plan, call or step from it as yours: your work is the brief and done-criteria above, and the rules in CREW.md.";

export function agentBrief(
  agentId: AgentId,
  issue: Pick<Issue, "id" | "title" | "description" | "doneCriteria"> & { brief: string },
  memory: { crewRules: MemoryText | null; index: MemoryText | null },
): string {
  return [
    `# ${issue.id}: ${issue.title}`,
    `You are agent ${agentId}, working on issue ${issue.id}. Your parent thread, a regional manager, started you with this brief. Your work is this issue: its brief and done-criteria below. Do it on your own branch.`,
    `## What it is about\n\n${issue.description.trim()}`,
    `## Brief\n\n${issue.brief.trim()}`,
    `## Done when\n\nEvery one of these holds, each checked by running something:\n\n${issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    memorySection("CREW.md", "the rules every agent follows", null, memory.crewRules),
    memorySection("MEMORY.md", "your regional manager's memory, for context", MEMORY_IS_CONTEXT, memory.index),
  ].join("\n\n");
}

/** A memory file under its own `##` section, with what it is to the agent (null: the heading says it all). */
function memorySection(file: string, holds: string, note: string | null, text: MemoryText | null): string {
  const lead = [`## ${file}: ${holds}`, ...(note === null ? [] : [note])].join("\n\n");
  if (text === null) return `${lead}\n\n(There is no ${file}.)`;
  return `${lead}\n\n${nested(text.content.trim())}`;
}

/**
 * The file's markdown with every heading two levels down, so its own `#` title sits under the
 * message's `##` section rather than above it. A title underlined with `===` or `---` is rewritten
 * with `#`s, as an underline makes nothing deeper than `##`. Fenced code is left as it is; the file
 * on disk is never changed. why not fence the whole file instead: the person reading the thread
 * then sees raw markdown in a code block, unwrapped, where this keeps it rendered.
 */
function nested(markdown: string): string {
  const lines: string[] = [];
  let fence: Fence | null = null;
  /** Where in `lines` the paragraph an underline would make a heading begins; null when none is open. */
  let paragraph: number | null = null;
  /** Whether the lines since the last blank one continue a list item, quote or HTML block, whose text an underline doesn't make a heading. */
  let container = false;
  for (const line of markdown.split("\n")) {
    if (fence !== null) {
      if (closes(fence, line)) fence = null;
      lines.push(line);
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line)?.[1];
    if (underline !== undefined && paragraph !== null) {
      const title = lines.splice(paragraph).join("\n");
      lines.push(`${title.slice(0, title.search(/\S/))}${"#".repeat(underline === "=" ? 3 : 4)} ${title.trim().replace(/\s*\n\s*/g, " ")}`);
      paragraph = null;
      continue;
    }
    fence = opens(line);
    if (fence !== null || /^\s*$/.test(line) || THEMATIC_BREAK.test(line) || ATX_HEADING.test(line)) [paragraph, container] = [null, false];
    else if (CONTAINER_START.test(line)) [paragraph, container] = [null, true];
    else if (paragraph === null && !container && !/^(?: {0,3}\t| {4})/.test(line)) paragraph = lines.length;
    lines.push(line.replace(ATX_HEADING, (_, indent: string, hashes: string) => `${indent}${"#".repeat(Math.min(hashes.length + 2, 6))}`));
  }
  return lines.join("\n");
}

/** A code fence's marker: its character and how many of them opened it. */
type Fence = { char: string; length: number };

const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(=|-)\1*[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CONTAINER_START = /^ {0,3}(?:[-+*][ \t]|[-+*]$|\d{1,9}[.)](?:[ \t]|$)|>|<)/;

/** The fence the line opens, or null: three or more backticks or tildes, and no backtick after backticks. */
function opens(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return null;
  const [, marker = "", info = ""] = match;
  return marker.startsWith("`") && info.includes("`") ? null : { char: marker.charAt(0), length: marker.length };
}

/** Whether the line closes the fence: its character, at least as many, and nothing after. */
function closes(fence: Fence, line: string): boolean {
  const marker = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
  return marker !== undefined && marker.charAt(0) === fence.char && marker.length >= fence.length;
}
