// The strip above a thread's composer: the summary row, and the list it opens
// above itself: the latest batch plus anything still running, under a row that
// opens the Subagents tab on the rest. Owns only UI state: whether the list is
// open, and which one row is expanded.
import { useId, useState } from "react";
import { experimental_Icon as Icon, experimental_useAppPanel, experimental_usePanelTabs, useComposer } from "@get-bb/plugin-sdk/app";
import type { Delegate, DelegateId } from "../delegate.ts";
import { census, isRunning, plural, selectRoster, span, type Batch, type Roster } from "../roster.ts";
import { formatDuration, useNow } from "../clock.ts";
import { useThreadDelegates } from "../source.ts";
import { openSubagents, subagentsTabShown } from "../subagents-tab.ts";
import { AvatarStack } from "./Avatar.tsx";
import { DelegateRow } from "./DelegateRow.tsx";
import { RollingNumber } from "./Motion.tsx";
import { trackRoomAbove } from "./room.ts";

export function RosterBanner() {
  const { scope } = useComposer();
  // why: app.tsx registers the banner for thread composers only, so any other scope is a broken contract.
  if (scope.kind !== "thread") throw new Error(`subagents-strip banner mounted in a ${scope.kind} composer`);
  // why: keyed by thread, so UI state never leaks from one thread into the next.
  return <Roster key={scope.threadId} threadId={scope.threadId} />;
}

function Roster({ threadId }: { threadId: string }) {
  const live = useThreadDelegates(threadId);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<DelegateId | null>(null);
  const listId = useId();
  if (live.status !== "ready") return null; // loading or failed draws nothing; bb's own UI is untouched
  const roster = selectRoster(live.delegates, live.turns);
  if (!roster) return null;
  return (
    // why: R8, a settled strip dims; CSS restores it on hover, focus, or open.
    <section className="sr" aria-label="Subagents" data-open={open || undefined} data-settled={!roster.rows.some(isRunning) || undefined}>
      <DelegateList
        id={listId}
        open={open}
        threadId={threadId}
        roster={roster}
        outlined={live.outlined}
        expanded={expanded}
        onToggleRow={(id) => setExpanded(expanded === id ? null : id)}
      />
      <SummaryRow delegates={roster.rows} latest={roster.latest} listId={listId} open={open} onToggle={() => setOpen(!open)} />
    </section>
  );
}

// ---------------------------------------------------------------- layer 2

type ListProps = {
  id: string;
  open: boolean;
  threadId: string;
  roster: Roster;
  outlined: ReadonlySet<DelegateId>;
  expanded: DelegateId | null;
  onToggleRow: (id: DelegateId) => void;
};

/** The list grows upward from the summary row, oldest first, so the newest sits nearest the composer. One row expands at a time. */
function DelegateList({ id, open, threadId, roster, outlined, expanded, onToggleRow }: ListProps) {
  return (
    // why: kept mounted while closed so it can animate shut; inert keeps it out of focus and the a11y tree.
    <div className="sr-wrap" ref={trackRoomAbove}>
      <div className="sr-clip">
        <div className="sr-panel" id={id} inert={!open}>
          <ol className="sr-list">
            {roster.previous.total > 0 && <PreviousRow threadId={threadId} previous={roster.previous} />}
            {roster.rows.map((d) => (
              <DelegateRow key={d.id} delegate={d} outlined={outlined.has(d.id)} expanded={d.id === expanded} onToggle={() => onToggleRow(d.id)} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/**
 * The list's oldest end: "N previous subagents", and how many of them failed or stopped. The row
 * opens the Subagents tab; each part is its own button, landing on the newest one it counts. The
 * row's button stretches over the whole row, under the parts (roster.css).
 */
function PreviousRow({ threadId, previous }: { threadId: string; previous: Roster["previous"] }) {
  const panel = experimental_useAppPanel();
  const shown = subagentsTabShown(experimental_usePanelTabs());
  return (
    <li className="sr-prev">
      <button type="button" className="sr-prev-open" aria-pressed={shown} title="Every subagent in this thread, in the side panel" onClick={() => openSubagents(panel, threadId, null)}>
        {plural(previous.total, "previous subagent")}
      </button>
      {previous.parts.map((p) => (
        <button key={p.status} type="button" className="sr-prev-part" data-st={p.status} title={`Show the newest ${p.word} subagent`} onClick={() => openSubagents(panel, threadId, p.newest)}>
          {p.count} {p.word}
        </button>
      ))}
      <Icon name="PanelRight" fallback="PanelRightOpen" className="sr-prev-icon" aria-hidden />
    </li>
  );
}

type SummaryProps = { delegates: readonly Delegate[]; latest: Batch; listId: string; open: boolean; onToggle: () => void };

/** R7: nothing here moves but the timer and the rolling counts. The time is the latest batch's alone. */
function SummaryRow({ delegates, latest, listId, open, onToggle }: SummaryProps) {
  const now = useNow(latest.delegates.some(isRunning));
  const { total, parts } = census(delegates);
  return (
    <button type="button" className="sr-sum" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
      <AvatarStack delegates={delegates} />
      <span className="sr-txt">
        <span className="sr-title"><RollingNumber value={total} /> {total === 1 ? "subagent" : "subagents"}</span>
        <span className="sr-census" aria-live="polite">
          {parts.map((p) => <span key={p.status} className="sr-part" data-st={p.status}><RollingNumber value={p.count} /> {p.word}</span>)}
        </span>
      </span>
      <span className="sr-el" title="The latest prompt's subagents">{formatDuration(span(latest.delegates, now))}</span>
      <Icon name="ChevronUp" className="sr-chev" aria-hidden />
    </button>
  );
}
