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
 * Each `#` heading outside a code fence goes two levels down, so the file's title sits under the message's `##` section.
 * Code is never changed: once a line might open or close a fence and only a list or quote around it could tell, the rest is
 * left as it is. Titles underlined with `===` and headings in lists or quotes keep their size: cosmetic, not worth a Markdown parser.
 */
function nested(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: Fence | null = null;
  for (const [i, line] of lines.entries()) {
    const next: Place = fence === null ? opens(line) : after(fence, line);
    if (next === "unsure") break;
    if (fence === null && next === null) lines[i] = line.replace(ATX_HEADING, (_, indent: string, hashes: string) => `${indent}${"#".repeat(Math.min(hashes.length + 2, 6))}`);
    fence = next;
  }
  return lines.join("\n");
}

/** A code fence: its marker's character, how many of them opened it, and the spaces before them. */
type Fence = { char: string; length: number; indent: string };

/** Where a line leaves the text: in a fence, outside one (null), or unsure, after which nothing is changed. */
type Place = Fence | null | "unsure";

const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;

/** The fence the line opens, or null; unsure when a tab, list marker or `>` comes before its marker. */
function opens(line: string): Place {
  const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return /^[ \t>*+\-\d.)]*(?:```|~~~)/.test(line) ? "unsure" : null;
  const [, indent = "", marker = "", info = ""] = match;
  return marker.startsWith("`") && info.includes("`") ? null : { char: marker.charAt(0), length: marker.length, indent };
}

/** The fence after the line: still open, closed (null) by a marker as indented as its opener's, or unsure when it may end elsewhere. */
function after(fence: Fence, line: string): Place {
  const indent = line.slice(0, line.search(/\S|$/));
  const marker = /^\s*(`+|~+)[ \t]*$/.exec(line)?.[1];
  if (marker?.charAt(0) === fence.char && marker.length >= fence.length) return indent === fence.indent ? null : "unsure";
  return line.trim() !== "" && indent.length < fence.indent.length ? "unsure" : fence;
}
