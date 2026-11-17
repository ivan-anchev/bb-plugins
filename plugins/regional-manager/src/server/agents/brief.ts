// An agent thread's first message: everything it needs to start without asking. The description,
// brief and done-criteria are its regional manager's; CREW.md and MEMORY.md are copied as they are
// at the start, so the agent follows the rules the user set and knows which memory files it can read.
import type { AgentId } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import type { MemoryText } from "../../model/memory-file.ts";

export function agentBrief(
  agentId: AgentId,
  issue: Pick<Issue, "id" | "title" | "description" | "doneCriteria"> & { brief: string },
  memory: { crewRules: MemoryText | null; index: MemoryText | null },
): string {
  return [
    `# ${issue.id}: ${issue.title}`,
    `You are agent ${agentId}, working on issue ${issue.id}. Your parent thread, a regional manager, started you with this brief. Do the work below on your own branch.`,
    `## What it is about\n\n${issue.description.trim()}`,
    `## Brief\n\n${issue.brief.trim()}`,
    `## Done when\n\nEvery one of these holds, each checked by running something:\n\n${issue.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    memorySection("CREW.md", "the rules every agent follows", memory.crewRules),
    memorySection("MEMORY.md", "the index of the memory you can read with crew_memory_read", memory.index),
  ].join("\n\n");
}

function memorySection(file: string, holds: string, text: MemoryText | null): string {
  const heading = `## ${file}: ${holds}`;
  if (text === null) return `${heading}\n\n(There is no ${file}.)`;
  return `${heading}\n\n${text.content.trim()}`;
}
