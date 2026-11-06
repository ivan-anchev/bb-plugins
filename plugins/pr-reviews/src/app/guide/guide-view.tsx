// The PR page below its header once a guide exists: the overview first, then one step at a time,
// with the controller pinned under the scrolling page.
import { useRef } from "react";
import type { GuideRecord, PrDetail } from "../../contract.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { useGuide, type GuideTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { Controller } from "./controller.tsx";
import { Overview } from "./overview.tsx";
import { PageTitle } from "./page-text.tsx";
import { StepPage } from "./step-page.tsx";
import { useStepKeys, useWalkthrough } from "./use-walkthrough.ts";

export function GuideView({ target, pr }: { target: GuideTarget; pr: PrDetail }) {
  const guide = useGuide(target);
  return (
    <>
      <ReadError read={guide} what="the guide" />
      {guide.isLoading && <Notice>Loading the guide…</Notice>}
      {guide.data !== undefined && <LoadedGuide pr={pr} record={guide.data.record} files={guide.data.files} />}
    </>
  );
}

type LoadedGuideProps = { pr: PrDetail; record: GuideRecord; files: DiffFile[] };

function LoadedGuide({ pr, record, files }: LoadedGuideProps) {
  // Issue 05 filters these by the view options; the index keeps the reader's place when it does.
  const steps = record.guide.steps.map((step, index) => ({ index, step }));
  const scroll = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const walkthrough = useWalkthrough(steps, { scroll, title });
  useStepKeys(walkthrough);
  const { place } = walkthrough;
  return (
    <>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
        {/* Keyed by page: each page opens fresh, with its rows folded again. */}
        <article
          key={place.kind === "overview" ? "overview" : place.step.index}
          className="grid max-w-[880px] grid-cols-[minmax(0,1fr)] content-start gap-[18px] px-7 pt-[18px] pb-10"
        >
          <PageTitle ref={title}>{place.title}</PageTitle>
          {place.kind === "overview" ? <Overview pr={pr} record={record} files={files} /> : <StepPage step={place.step.step} files={files} />}
        </article>
      </div>
      <Controller walkthrough={walkthrough} />
    </>
  );
}
