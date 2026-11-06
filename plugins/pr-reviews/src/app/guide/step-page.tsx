// One walkthrough step under its title: the explanation, "For you to decide" when the agent left
// the reader a decision, then the step's hunks in order.
import { fileOf, type DiffFile } from "../../diff/diff-schema.ts";
import type { GuideStep } from "../../guide/guide-schema.ts";
import { Prose } from "../ui/prose.tsx";
import { HunkBlock } from "./hunk-block.tsx";
import { PROSE } from "./page-text.tsx";

export function StepPage({ step, files }: { step: GuideStep; files: DiffFile[] }) {
  return (
    <>
      <Prose text={step.explanation} className={PROSE} />
      {step.forYou !== null && <ForYou text={step.forYou} />}
      {step.hunks.map((entry) => (
        <HunkBlock key={`${entry.file}\u0000${entry.hunk}`} file={fileOf(files, entry.file)} entry={entry} />
      ))}
    </>
  );
}

// A tinted block, no border (the spec's visual rules).
function ForYou({ text }: { text: string }) {
  return (
    <section className="grid max-w-[75ch] gap-1 rounded-lg bg-timeline-accent/10 px-3.5 py-3 text-[13.5px] leading-5">
      <h3 className="font-semibold">For you to decide</h3>
      <Prose text={text} />
    </section>
  );
}
