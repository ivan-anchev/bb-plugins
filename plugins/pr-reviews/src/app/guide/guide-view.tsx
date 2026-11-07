// The Guide tab once a guide exists: the overview first, then one step at a time, with the
// controller pinned under the scrolling page.
import { useRef } from "react";
import type { GuideRecord } from "../../contract.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { hiddenTestHunkCount, visibleFindings } from "../../guide/walkthrough.ts";
import { useGuide, type GuideTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { Controller } from "./controller.tsx";
import { Overview } from "./overview.tsx";
import { PageTitle } from "./page-text.tsx";
import { StepPage } from "./step-page.tsx";
import { useStepKeys, useWalkthrough } from "./use-walkthrough.ts";
import type { ViewOptionsState } from "./view-options.tsx";

/** `shown`: whether the Guide tab is on screen; the page keeps the guide mounted under another tab. */
type GuideViewProps = { target: GuideTarget; viewOptions: ViewOptionsState; shown: boolean };

export function GuideView({ target, viewOptions, shown }: GuideViewProps) {
  const guide = useGuide(target);
  return (
    <>
      <ReadError read={guide} what="the guide" />
      {guide.isLoading && <Notice>Loading the guide…</Notice>}
      {guide.data !== undefined && <LoadedGuide target={target} record={guide.data.record} files={guide.data.files} viewOptions={viewOptions} shown={shown} />}
    </>
  );
}

type LoadedGuideProps = { target: GuideTarget; record: GuideRecord; files: DiffFile[]; viewOptions: ViewOptionsState; shown: boolean };

function LoadedGuide({ target, record, files, viewOptions, shown }: LoadedGuideProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const walkthrough = useWalkthrough(record.guide, viewOptions, { scroll, title });
  useStepKeys(walkthrough, shown);
  const { place, setOptions } = walkthrough;
  const { options } = viewOptions;
  const findings = visibleFindings(record.guide, options);
  return (
    <>
      {/* A size container: the step page's columns and its sticky story read its width and height. */}
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto [container-type:size]">
        {/* Keyed by page: each page opens fresh, with its rows folded again. */}
        {place.kind === "overview" ? (
          <article key="overview" className="grid max-w-[880px] grid-cols-[minmax(0,1fr)] content-start gap-[18px] px-7 pt-[18px] pb-10">
            <PageTitle ref={title}>{place.title}</PageTitle>
            <Overview
              record={record}
              files={files}
              findings={findings}
              steps={walkthrough.steps}
              onOpenStep={walkthrough.goToStep}
              hiddenTests={hiddenTestHunkCount(record.guide, options)}
              onShowTests={() => setOptions({ ...options, showTests: true })}
            />
          </article>
        ) : (
          <StepPage key={place.step.index} place={place} total={walkthrough.steps.length} title={title} files={files} findings={findings} target={target} />
        )}
      </div>
      <Controller walkthrough={walkthrough} />
    </>
  );
}
