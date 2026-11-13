// The card's subthreads (P:1333-1352): "Subthreads 5 · 2 running", then each line a small row of the
// sidebar's own (its agent's mark, its title fading out, its state ELSE its time) hung on 1-point
// hairlines; a press opens that subthread. Checkouts elsewhere head their rows with their branch.
// "Show all N" opens the parent when lines were left out.
import type { Checkout, Rail, SubthreadTree, TreeLine } from "../../card/subthread-tree.ts";
import { lastMoved } from "../../model/activity.ts";
import { STATE_NAME } from "../../model/state.ts";
import { ago } from "../../model/time.ts";
import { AgentMark, FadingTitle } from "../row/row.tsx";
import { StateGlyph } from "../state-glyph.tsx";
import { CardGlyph } from "./card-glyphs.tsx";

type Props = { tree: SubthreadTree; now: number; onOpen(threadId: string): void; onShowAll(): void };

export function SubthreadSection({ tree, now, onOpen, onShowAll }: Props) {
  return (
    <>
      <div className="as-card-sub">
        <div className="as-card-sub-head">
          <span className="as-card-g">
            <CardGlyph name="subthreads" />
          </span>
          Subthreads
          <span>
            {tree.total}
            {tree.running > 0 && ` · ${tree.running} running`}
          </span>
        </div>
        <div>
          {tree.lines.map((line, i) => (
            // why: a thread is on one line only; a head is said once per place under its node, so its
            // position is its identity.
            <div key={line.kind === "thread" ? line.thread.id : `place:${i}`} className="as-mini" data-place={line.kind === "place" || undefined}>
              <Rails rail={line} />
              <span className="as-mini-pad" style={{ width: line.indent }} />
              {line.kind === "thread" ? <ThreadLine line={line} now={now} onOpen={onOpen} /> : <PlaceLine line={line} />}
            </div>
          ))}
        </div>
      </div>
      {tree.hidden > 0 && (
        <button type="button" className="as-card-all" onClick={onShowAll}>
          Show all {tree.total}
        </button>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

type ThreadTreeLine = Extract<TreeLine, { kind: "thread" }>;
type PlaceTreeLine = Extract<TreeLine, { kind: "place" }>;

function ThreadLine({ line, now, onOpen }: { line: ThreadTreeLine; now: number; onOpen(threadId: string): void }) {
  const t = line.thread;
  const time = ago(lastMoved(t), now);
  return (
    <button
      type="button"
      className="as-mini-body"
      data-strong={line.state !== null || undefined}
      aria-label={`${t.displayTitle}, ${line.state === null ? `${time} ago` : STATE_NAME[line.state]}`}
      onClick={() => onOpen(t.id)}
    >
      <span className="as-mini-slot">
        <span className="as-mini-mark">
          <AgentMark providerId={t.providerId} />
        </span>
      </span>
      <FadingTitle text={t.displayTitle} />
      <span className="as-mini-corner">{line.state === null ? <span className="as-hint">{time}</span> : <StateGlyph state={line.state} size={12} />}</span>
    </button>
  );
}

/** A checkout's head: its branch, and "worktree · 3" (or "2 worktrees · 3") at its end. */
function PlaceLine({ line }: { line: PlaceTreeLine }) {
  const kind = line.checkout.kind;
  return (
    <div className="as-mini-body">
      <span className="as-mini-slot">
        <CardGlyph name="branch" />
      </span>
      <FadingTitle text={placeName(line.checkout)} />
      <span className="as-mini-corner">
        <span className="as-hint">
          {line.checkouts > 1 ? `${line.checkouts} ${kind}s` : kind} · {line.threads}
        </span>
      </span>
    </div>
  );
}

const CH = 24; // a line's height
const BEND = 4; // the elbow's radius

/** The line's hairlines: outer trunks running on past it, its own trunk bending into it, and on below
 * unless it is the last (P:1333-1338). */
function Rails({ rail }: { rail: Rail }) {
  const x = rail.at + 0.5;
  const mid = CH / 2;
  const tip = rail.indent + 2;
  let d = rail.through.map((tx) => `M${tx + 0.5} -2V${CH}`).join("");
  d += `M${x} -2V${mid - BEND}A${BEND} ${BEND} 0 0 0 ${x + BEND} ${mid}H${tip}`;
  if (!rail.last) d += `M${x} ${mid - BEND}V${CH}`;
  return (
    <svg className="as-mini-rails" width={tip + 1} height={CH} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Z: the checkout's branch, else what it is (P:401). */
function placeName(c: Checkout): string {
  return c.branch ?? (c.kind === "workspace" ? "Personal workspace" : "No branch");
}
