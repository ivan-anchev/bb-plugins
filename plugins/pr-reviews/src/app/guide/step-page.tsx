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

export function StepPage({ place, total, title, files, findings, head }: StepPageProps) {
  const step = place.step.step;
  const findingsByHunk = useMemo(() => step.hunks.map((entry) => findingsOn(findings, entry)), [step, findings]);
  const firstHunks = useRef(new Map<string, HTMLElement>());
  const comments = useComments({ projectId: head.projectId, number: head.number });
  return (
    <article className="grid max-w-[880px] grid-cols-[minmax(0,1fr)] gap-x-10 px-6 pb-10 @min-[900px]:max-w-[1440px] @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4 pt-4 @min-[900px]:sticky @min-[900px]:top-0 @min-[900px]:max-h-[100cqh] @min-[900px]:self-start @min-[900px]:overflow-y-auto @min-[900px]:pb-6">
        <hgroup className="grid gap-1">
          <StepCounter number={place.number} total={total} />
          <PageTitle ref={title}>{place.title}</PageTitle>
        </hgroup>
        <Prose text={step.explanation} className={PROSE} />
        {step.forYou !== null && <ForYou text={step.forYou} />}
        <StepFileList files={stepFilesOf(step, files)} onJump={(path) => jumpTo(firstHunks.current.get(path)!)} />
      </div>
      <div className="grid content-start gap-4 pt-4">
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

function StepCounter({ number, total }: { number: number; total: number }) {
  const pad = (count: number) => String(count).padStart(2, "0");
  return (
    <p className="text-sm tabular-nums text-muted-foreground">
      {pad(number)} <span className="text-subtle-foreground">/ {pad(total)}</span>
    </p>
  );
}

function ForYou({ text }: { text: string }) {
  return (
    <section className="grid max-w-[75ch] gap-1 rounded-lg bg-timeline-accent/10 px-3.5 py-3 text-sm leading-5">
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

function jumpTo(block: HTMLElement) {
  block.focus({ preventScroll: true });
  block.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
