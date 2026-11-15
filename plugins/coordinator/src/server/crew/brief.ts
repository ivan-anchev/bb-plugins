// A crew thread's first message: everything it needs to start without asking. The brief and the
// done-criteria are the Coordinator's; CREW.md and MEMORY.md are copied as they are at the start,
// so the crew follows the rules the user set and knows which memory files it can read.
import type { Crew } from "../../model/crew.ts";
import type { MemoryText } from "../../model/memory-file.ts";
import { DISPLAY_NAME } from "../../name.ts";

export function crewBrief(crew: Pick<Crew, "id" | "title" | "brief" | "doneCriteria">, memory: { crewRules: MemoryText | null; index: MemoryText | null }): string {
  return [
    `# ${crew.title}`,
    `You are crew ${crew.id} of a ${DISPLAY_NAME}: your parent thread, which started you with this brief. Do the work below on your own branch.`,
    `## Brief\n\n${crew.brief.trim()}`,
    `## Done when\n\nEvery one of these holds, each checked by running something:\n\n${crew.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    memorySection("CREW.md", "the rules every crew follows", memory.crewRules),
    memorySection("MEMORY.md", "the index of the memory you can read with crew_memory_read", memory.index),
  ].join("\n\n");
}

function memorySection(file: string, holds: string, text: MemoryText | null): string {
  const heading = `## ${file}: ${holds}`;
  if (text === null) return `${heading}\n\n(There is no ${file}.)`;
  return `${heading}\n\n${text.content.trim()}`;
}
