import { useMemo, useRef, type ReactNode, type Ref } from "react";
import type { GuideRecord } from "../../contract.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { hiddenTestHunkCount, visibleFindings } from "../../guide/walkthrough.ts";
import { useGuide, type PrHeadTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { Controller } from "./controller.tsx";
import { Overview } from "./overview.tsx";
import { PageTitle } from "./page-text.tsx";
import { StepPage } from "./step-page.tsx";
import { useStepKeys, useWalkthrough } from "./use-walkthrough.ts";
import type { ViewOptionsState } from "./view-options.tsx";

/** `shown`: whether the Guide tab is on screen; the page keeps the guide mounted under another tab. */
type GuideViewProps = { head: PrHeadTarget; viewOptions: ViewOptionsState; shown: boolean };

export function GuideView({ head: { projectId, number, headSha }, viewOptions, shown }: GuideViewProps) {
  const head = useMemo(() => ({ projectId, number, headSha }), [projectId, number, headSha]);
  const guide = useGuide(head);
  const error = <ReadError read={guide} what="the guide" />;
  if (guide.data === undefined) {
    return (
      <GuidePage>
        {error}
        {guide.isLoading && <Notice>Loading the guide…</Notice>}
      </GuidePage>
    );
  }
  return (
    <>
      {error}
      <LoadedGuide head={head} record={guide.data.record} files={guide.data.files} viewOptions={viewOptions} shown={shown} />
    </>
  );
}

type LoadedGuideProps = { head: PrHeadTarget; record: GuideRecord; files: DiffFile[]; viewOptions: ViewOptionsState; shown: boolean };

function LoadedGuide({ head, record, files, viewOptions, shown }: LoadedGuideProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const walkthrough = useWalkthrough(record.guide, viewOptions, { scroll, title });
  useStepKeys(walkthrough, shown);
  const { place, setOptions } = walkthrough;
  const { options } = viewOptions;
  const findings = useMemo(() => visibleFindings(record.guide, options), [record.guide, options]);
  return (
    <>
      <GuidePage ref={scroll}>
        {place.kind === "overview" ? (
          <article key="overview" className="grid max-w-[880px] grid-cols-[minmax(0,1fr)] content-start gap-4 px-6 pt-4 pb-10">
            <PageTitle ref={title}>{place.title}</PageTitle>
            <Overview
              record={record}
              files={files}
              head={head}
              findings={findings}
              steps={walkthrough.steps}
              onOpenStep={walkthrough.goToStep}
              hiddenTests={hiddenTestHunkCount(record.guide, options)}
              onShowTests={() => setOptions({ ...options, showTests: true })}
            />
          </article>
        ) : (
          <StepPage key={place.step.index} place={place} total={walkthrough.steps.length} title={title} files={files} findings={findings} head={head} />
        )}
      </GuidePage>
      <Controller walkthrough={walkthrough} />
    </>
  );
}

function GuidePage({ ref, children }: { ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Guide page"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto outline-none [container-type:size] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}
