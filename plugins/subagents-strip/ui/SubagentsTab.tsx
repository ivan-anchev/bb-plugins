import { useMemo, type JSX, type Ref } from "react";
import { experimental_useAppPanel, experimental_useTabVisible, type ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk/app";
import type { Delegate, DelegateId, Turn } from "../delegate.ts";
import { census, plural, selectBatches } from "../roster.ts";
import { useThreadDelegates } from "../source.ts";
import { KEPT_THREADS, openSubagents, parseTabParams, SUBAGENTS_TAB, useLanding, type Landing } from "../subagents-tab.ts";
import { EMPTY_VIEW, isOpen, landOn, toggleBatch, toggleRow, type View } from "../subagents-view.ts";
import { threadState, useThreadState } from "../thread-state.ts";
import { BatchSection } from "./BatchSection.tsx";
import { TranscriptTab } from "./TranscriptTab.tsx";

export const SUBAGENTS_TAB_REGISTRATION = {
  ...SUBAGENTS_TAB,
  title: "Subagents",
  icon: "Bot",
  layout: "flush",
  component: SubagentsTab,
} as const;

function SubagentsTab({ threadId, params }: ExperimentalThreadActionTabProps): JSX.Element | null {
  const shows = parseTabParams(params);
  switch (shows.kind) {
    case "list": return <List threadId={threadId} />;
    case "transcript": return <TranscriptTab threadId={threadId} delegateId={shows.delegateId} />;
    default:
      shows satisfies never;
      return null;
  }
}

function List({ threadId }: { threadId: string }): JSX.Element | null {
  const live = useThreadDelegates(threadId, { enabled: experimental_useTabVisible(), history: true });
  switch (live.status) {
    case "loading": return null;
    case "failed": return <p className="sr-tx-empty">The subagents could not be read: {live.message}</p>;
    case "ready": return <Subagents threadId={threadId} delegates={live.delegates} turns={live.turns} outlined={live.outlined} />;
  }
}

const views = threadState<View>(EMPTY_VIEW, KEPT_THREADS);

type Props = { threadId: string; delegates: readonly Delegate[]; turns: readonly Turn[]; outlined: ReadonlySet<DelegateId> };

function Subagents({ threadId, delegates, turns, outlined }: Props) {
  const saved = useThreadState(views, threadId);
  const landing = useLanding(threadId);
  const batches = selectBatches(delegates, turns);
  const pending = landing !== saved.landed ? landing : null;
  const view = pending ? landOn(saved, pending, batches) : saved;
  const landedRow = useLandedRow(threadId, pending, view);
  return (
    <section className="sr sr-pn" aria-label="Subagents">
      <Header threadId={threadId} delegates={delegates} />
      <div className="sr-pn-scroll">
        <ol className="sr-pn-batches">
          {batches.map((batch) => (
            <BatchSection
              key={batch.id ?? "before-first-prompt"}
              batch={batch}
              open={isOpen(view, batch)}
              onToggle={() => views.set(threadId, toggleBatch(view, batch, batches))}
              expanded={view.expanded}
              onToggleRow={(id) => views.set(threadId, toggleRow(view, id, batches))}
              outlined={outlined}
              rowRef={landedRow}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function useLandedRow(threadId: string, pending: Landing | null, landed: View): (id: DelegateId) => Ref<HTMLLIElement> | undefined {
  return useMemo(() => {
    const land = (el: HTMLLIElement | null) => {
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      views.set(threadId, landed);
    };
    return (id: DelegateId) => (id === pending?.delegateId ? land : undefined);
  }, [pending]);
}

function Header({ threadId, delegates }: { threadId: string; delegates: readonly Delegate[] }) {
  const panel = experimental_useAppPanel();
  const { total, parts } = census(delegates);
  return (
    <header className="sr-pn-head">
      <h2 className="sr-tx-title">{plural(total, "subagent")}</h2>
      <p className="sr-pn-census">
        {parts.map((p) => (
          <button key={p.status} type="button" className="sr-pn-part" data-st={p.status} title={`Show the newest ${p.word} subagent`} onClick={() => openSubagents(panel, threadId, p.newest)}>
            {p.count} {p.word}
          </button>
        ))}
      </p>
    </header>
  );
}
