// The strip above a thread's composer. In this slice it is the summary row:
// the avatar stack, "N subagents", the census, and the wall-clock span.
import { useComposer } from "@get-bb/plugin-sdk/app";
import type { Delegate } from "../delegate.ts";
import { census, isRunning, selectRoster, span } from "../roster.ts";
import { formatDuration, useNow } from "../clock.ts";
import { useThreadDelegates } from "../source.ts";
import { AvatarStack } from "./Avatar.tsx";

export function RosterBanner() {
  const { scope } = useComposer();
  // why: app.tsx registers the banner for thread composers only, so any other scope is a broken contract.
  if (scope.kind !== "thread") throw new Error(`subagents-strip banner mounted in a ${scope.kind} composer`);
  // why: keyed by thread, so UI state never leaks from one thread into the next.
  return <Roster key={scope.threadId} threadId={scope.threadId} />;
}

function Roster({ threadId }: { threadId: string }) {
  const live = useThreadDelegates(threadId);
  if (live.status !== "ready") return null; // loading or failed draws nothing; bb's own UI is untouched
  const roster = selectRoster(live.delegates);
  if (roster.length === 0) return null;
  return (
    <section className="sr" aria-label="Subagents">
      <SummaryRow providerId={live.providerId} delegates={roster} />
    </section>
  );
}

function SummaryRow({ providerId, delegates }: { providerId: string; delegates: readonly Delegate[] }) {
  const now = useNow(delegates.some(isRunning));
  const { total, parts } = census(delegates);
  return (
    <div className="sr-sum">
      <AvatarStack providerId={providerId} delegates={delegates} />
      <span className="sr-txt">
        <span className="sr-title">{total} {total === 1 ? "subagent" : "subagents"}</span>
        <span className="sr-census" aria-live="polite">
          {parts.map((p) => <span key={p.status} className="sr-part" data-st={p.status}>{p.count} {p.word}</span>)}
        </span>
      </span>
      <span className="sr-el">{formatDuration(span(delegates, now))}</span>
    </div>
  );
}
