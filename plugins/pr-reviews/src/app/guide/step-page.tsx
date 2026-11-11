// One walkthrough step in two columns. The story on the left: the step counter, the title, the
// explanation, "For you to decide" when the agent left the reader a decision, and the files the
// step touches. It stays in view while the diffs on the right scroll: the step's hunks in order,
// each with its findings. Below about 900px of page width the columns stack, story first.
import { useMemo, useRef, type Ref } from "react";
import { fileOf, type DiffFile } from "../../diff/diff-schema.ts";
import type { GuideStep } from "../../guide/guide-schema.ts";
import { stepFilesOf } from "../../guide/step-files.ts";
import { findingsOn, type VisibleFinding } from "../../guide/walkthrough.ts";
import { useComments, type PrHeadTarget } from "../queries.ts";
import { Prose } from "../ui/prose.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { HunkBlock } from "./hunk-block.tsx";
import { PageTitle, PROSE } from "./page-text.tsx";
import { StepFileList } from "./step-file-list.tsx";
import type { Place } from "./walkthrough-position.ts";

type StepPlace = Extract<Place, { kind: "step" }>;

type StepPageProps = {
  place: StepPlace;
  /** The steps shown, which the counter counts. */
  total: number;
  /** The page title, where the walkthrough hands focus. */
  title: Ref<HTMLHeadingElement>;
  files: DiffFile[];
  findings: VisibleFinding[];
  head: PrHeadTarget;
};

// The columns' own top padding, not the page's, so the sticky story lines up with the diffs.
// `100cqh` is the scroll region's height (guide-view.tsx makes it a size container).
// The story's own track is `minmax(0,1fr)`: an implicit `auto` track grows to its widest child's
// min-content, and a file row's min-content is its whole unwrapped path.
export function StepPage({ place, total, title, files, findings, head }: StepPageProps) {
  const step = place.step.step;
  // why memoised: each hunk's diff is handed its findings as line annotations, and new ones make it draw again.
  const findingsByHunk = useMemo(() => step.hunks.map((entry) => findingsOn(findings, entry)), [step, findings]);
  const firstHunks = useRef(new Map<string, HTMLElement>());
  // Each hunk's diff draws its threads from this read; a failed read shows once, above them.
  const comments = useComments({ projectId: head.projectId, number: head.number });
  return (
    <article className="grid max-w-[880px] grid-cols-[minmax(0,1fr)] gap-x-10 px-7 pb-10 @min-[900px]:max-w-[1440px] @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-[18px] pt-[18px] @min-[900px]:sticky @min-[900px]:top-0 @min-[900px]:max-h-[100cqh] @min-[900px]:self-start @min-[900px]:overflow-y-auto @min-[900px]:pb-6">
        <hgroup className="grid gap-1">
          <StepCounter number={place.number} total={total} />
          <PageTitle ref={title}>{place.title}</PageTitle>
        </hgroup>
        <Prose text={step.explanation} className={PROSE} />
        {step.forYou !== null && <ForYou text={step.forYou} />}
        {/* Every listed file has a first hunk on the right, which registered itself on mount. */}
        <StepFileList files={stepFilesOf(step, files)} onJump={(path) => jumpTo(firstHunks.current.get(path)!)} />
      </div>
      <div className="grid content-start gap-[18px] pt-[18px]">
        <ReadError read={comments} what="the PR's comments" />
        {step.hunks.map((entry, i) => (
          <HunkBlock
            key={`${entry.file}\u0000${entry.hunk}`}
            ref={isFirstOfFile(step, i) ? firstHunkRef(firstHunks.current, entry.file) : undefined}
            file={fileOf(files, entry.file)}
            entry={entry}
            findings={findingsByHunk[i]}
            head={head}
            comments={comments.data}
            withFileThreads={isFirstOfFile(step, i)}
          />
        ))}
      </div>
    </article>
  );
}

// "01 / 03", as the screenshot the layout follows reads.
function StepCounter({ number, total }: { number: number; total: number }) {
  const pad = (count: number) => String(count).padStart(2, "0");
  return (
    <p className="text-[13px] tabular-nums text-muted-foreground">
      {pad(number)} <span className="text-subtle-foreground">/ {pad(total)}</span>
    </p>
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

const isFirstOfFile = (step: GuideStep, at: number) => step.hunks.findIndex((entry) => entry.file === step.hunks[at].file) === at;

const firstHunkRef = (firstHunks: Map<string, HTMLElement>, path: string) => (block: HTMLElement) => {
  firstHunks.set(path, block);
  return () => {
    firstHunks.delete(path);
  };
};

// Focus first without scrolling, then one scroll to the block: smooth, unless the reader asks for less motion.
function jumpTo(block: HTMLElement) {
  block.focus({ preventScroll: true });
  block.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
