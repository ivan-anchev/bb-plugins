// The plugin's one side-panel tab. Its params pick the instance: the list, which
// the strip's previous row and bb's launcher open, or one subagent's transcript
// (TranscriptTab.tsx), which Open thread opens. The list is every subagent in
// the thread, in batches, newest prompt first, under the thread's census; its
// rows are the strip's own. It reads the strip's source, and asks it for the
// full history while it shows. Its UI state (subagents-view.ts) is kept per
// thread, outside the tab, which bb unmounts while another tab is selected.
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
  // why: bb has no built-in group-of-people icon (UsersRound falls back to Zap, live).
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
      shows satisfies never; // why: our own type, parsed once at the boundary, so a new kind is a compile error here
      return null;
  }
}

// ---------------------------------------------------------------- layer 2

// why: the declared return type makes an unhandled source status a compile error.
function List({ threadId }: { threadId: string }): JSX.Element | null {
  // why: bb keeps a closed panel's tab mounted; only a showing tab follows the source, and reads the full history.
  const live = useThreadDelegates(threadId, { enabled: experimental_useTabVisible(), history: true });
  switch (live.status) {
    case "loading": return null;
    case "failed": return <p className="sr-tx-empty">The subagents could not be read: {live.message}</p>;
    case "ready": return <Subagents threadId={threadId} delegates={live.delegates} turns={live.turns} outlined={live.outlined} />;
  }
}

// why: the user's toggles win, across tab switches; thread-state.ts says how long they are kept.
const views = threadState<View>(EMPTY_VIEW, KEPT_THREADS);

type Props = { threadId: string; delegates: readonly Delegate[]; turns: readonly Turn[]; outlined: ReadonlySet<DelegateId> };

function Subagents({ threadId, delegates, turns, outlined }: Props) {
  const saved = useThreadState(views, threadId);
  const landing = useLanding(threadId);
  const batches = selectBatches(delegates, turns);
  // why: a landing not yet shown is laid over the saved view as the tab renders, so its first frame already
  // shows the row open in its batch; showing it saves it, so it lands once.
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

/** The ref for the row a pending landing names: it scrolls the row into view and saves the landed view. */
function useLandedRow(threadId: string, pending: Landing | null, landed: View): (id: DelegateId) => Ref<HTMLLIElement> | undefined {
  // why: keyed on the landing alone, so React attaches the ref, and so scrolls, once per jump, to a row already
  // mounted too. The view it saves is the one the landing was first laid over: until it is saved, any save adopts it.
  return useMemo(() => {
    const land = (el: HTMLLIElement | null) => {
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      views.set(threadId, landed);
    };
    return (id: DelegateId) => (id === pending?.delegateId ? land : undefined);
  }, [pending]);
}

/** The thread's census, and nothing else; each part lands on the newest subagent it counts. */
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
