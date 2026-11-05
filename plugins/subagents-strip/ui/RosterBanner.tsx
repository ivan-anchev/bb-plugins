// The strip above a thread's composer: the summary row, and the list of
// delegates it opens above itself. Owns only UI state (whether the list is open).
import { useId, useState } from "react";
import { experimental_Icon as Icon, useComposer } from "@get-bb/plugin-sdk/app";
import type { Delegate } from "../delegate.ts";
import { census, isRunning, selectRoster, span } from "../roster.ts";
import { formatDuration, useNow } from "../clock.ts";
import { useThreadDelegates } from "../source.ts";
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
  const listId = useId();
  if (live.status !== "ready") return null; // loading or failed draws nothing; bb's own UI is untouched
  const roster = selectRoster(live.delegates);
  if (roster.length === 0) return null;
  return (
    // why: R8, a settled strip dims; CSS restores it on hover, focus, or open.
    <section className="sr" aria-label="Subagents" data-open={open || undefined} data-settled={!roster.some(isRunning) || undefined}>
      <DelegateList id={listId} open={open} providerId={live.providerId} delegates={roster} />
      <SummaryRow providerId={live.providerId} delegates={roster} listId={listId} open={open} onToggle={() => setOpen(!open)} />
    </section>
  );
}

/** The list grows upward from the summary row, oldest first, so the newest sits nearest the composer. */
function DelegateList({ id, open, providerId, delegates }: { id: string; open: boolean; providerId: string; delegates: readonly Delegate[] }) {
  return (
    // why: kept mounted while closed so it can animate shut; inert keeps it out of focus and the a11y tree.
    <div className="sr-wrap" ref={trackRoomAbove}>
      <div className="sr-clip">
        <div className="sr-panel" id={id} inert={!open}>
          <ol className="sr-list">
            {delegates.map((d) => <DelegateRow key={d.id} providerId={providerId} delegate={d} />)}
          </ol>
        </div>
      </div>
    </div>
  );
}

type SummaryProps = { providerId: string; delegates: readonly Delegate[]; listId: string; open: boolean; onToggle: () => void };

/** R7: nothing here moves but the timer and the rolling counts. */
function SummaryRow({ providerId, delegates, listId, open, onToggle }: SummaryProps) {
  const now = useNow(delegates.some(isRunning));
  const { total, parts } = census(delegates);
  return (
    <button type="button" className="sr-sum" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
      <AvatarStack providerId={providerId} delegates={delegates} />
      <span className="sr-txt">
        <span className="sr-title"><RollingNumber value={total} /> {total === 1 ? "subagent" : "subagents"}</span>
        <span className="sr-census" aria-live="polite">
          {parts.map((p) => <span key={p.status} className="sr-part" data-st={p.status}><RollingNumber value={p.count} /> {p.word}</span>)}
        </span>
      </span>
      <span className="sr-el">{formatDuration(span(delegates, now))}</span>
      <Icon name="ChevronUp" className="sr-chev" aria-hidden />
    </button>
  );
}
