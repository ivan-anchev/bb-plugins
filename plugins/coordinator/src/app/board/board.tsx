// The board of one coordinating thread: its digest, then its crews grouped Needs you, Ready for
// review, Working, Idle and Done. The Board tab in the thread and the Board page in the panel both
// draw it, from one read; each gives it the scrolling root it sits in.
import { experimental_Icon as Icon, experimental_useRpcQuery, Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useId, type Ref } from "react";
import { coordinatorContract as contract, type Board as BoardData, type BoardRow } from "../../contract.ts";
import { BOARD_STATE_LABELS, byState, type BoardState } from "../../model/crew-state.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { useFocusKeptByKey } from "../ui/focus-hand-off.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { DraftRow } from "./draft/draft-row.tsx";
import { DroppedEdit } from "./draft/dropped-edit.tsx";

export function Board({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const read = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } });
  // why: each heading labels its section by id, and a page may show more than one board.
  const ids = useId();
  return (
    <div className="flex flex-col gap-6">
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
      {read.data === undefined && read.error === null && <p className="px-2 text-sm text-muted-foreground">Loading the board…</p>}
      {read.data !== undefined && (
        <>
          <Digest ids={ids} digest={read.data.digest} />
          <Crews ids={ids} coordinatorId={coordinatorId} rows={read.data.rows} />
        </>
      )}
    </div>
  );
}

function Digest({ ids, digest }: { ids: string; digest: BoardData["digest"] }) {
  const { title, body } = titled(digest?.content ?? "");
  return (
    <section aria-labelledby={`${ids}-digest`} className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${ids}-digest`} className="text-sm font-medium">
          {title}
        </h2>
        {digest !== null && (
          <time dateTime={new Date(digest.modifiedAt).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
            Updated {updatedAt(digest.modifiedAt)}
          </time>
        )}
      </div>
      {digest === null ? <p className="text-sm text-muted-foreground">There is no DIGEST.md.</p> : <Markdown content={body} className="text-sm" />}
    </section>
  );
}

/** The digest's own top heading, if it starts with one, as the section's title; else "Digest". */
function titled(content: string): { title: string; body: string } {
  const match = /^#[ \t]+(.+)\n+([\s\S]*)$/.exec(content.trimStart());
  return match === null ? { title: "Digest", body: content } : { title: match[1]?.trim() ?? "Digest", body: match[2] ?? "" };
}

function Crews({ ids, coordinatorId, rows }: { ids: string; coordinatorId: CoordinatorId; rows: readonly BoardRow[] }) {
  const keepFocus = useFocusKeptByKey();
  if (rows.length === 0) {
    return <p className="px-2 text-sm text-muted-foreground">No crews yet. The {DISPLAY_NAME} starts one for each piece of work it delegates.</p>;
  }
  return byState(rows).map(({ state, rows: inState }) => (
    <section key={state} aria-labelledby={`${ids}-${state}`} className="flex flex-col gap-1">
      <h2 id={`${ids}-${state}`} className="flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <span aria-hidden className={`size-1.5 rounded-full ${DOT[state]}`} />
        {BOARD_STATE_LABELS[state]}
        <span className="tabular-nums">{inState.length}</span>
      </h2>
      <ul className="flex flex-col">
        {inState.map((row) => (
          <li key={row.crewId}>
            {row.draft === null ? (
              <>
                <Row ref={keepFocus(row.crewId)} row={row} />
                <DroppedEdit coordinatorId={coordinatorId} row={row} />
              </>
            ) : (
              <DraftRow ref={keepFocus(row.crewId)} coordinatorId={coordinatorId} row={row} draft={row.draft} />
            )}
          </li>
        ))}
      </ul>
    </section>
  ));
}

const DOT: Record<BoardState, string> = {
  "needs-you": "bg-warning",
  "ready-for-review": "bg-pr-merged",
  working: "bg-success",
  idle: "bg-muted-foreground",
  done: "border border-muted-foreground",
};

/** A crew: its id, title, headline and branch. One with a thread opens it. */
// why a grid: the headline lines up under the title, whatever the id's width.
const ROW = "grid w-full grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left";

function Row({ ref, row }: { ref: Ref<HTMLButtonElement>; row: BoardRow }) {
  const navigate = useBbNavigate();
  const body = (
    <>
      <span className="font-mono text-xs text-muted-foreground">{row.crewId}</span>
      <span className="truncate text-sm">{row.title}</span>
      <span className="col-start-2 text-xs text-muted-foreground">{row.headline}</span>
      {row.branch !== null && (
        <span className="col-start-2 flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
          <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{row.branch}</span>
        </span>
      )}
    </>
  );
  const threadId = row.threadId;
  if (threadId === null) return <div className={ROW}>{body}</div>;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => navigate.toThread(threadId)}
      className={`${ROW} cursor-pointer hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
    >
      {body}
    </button>
  );
}

/** The time the digest changed: today's as a time, an older one with its date. */
function updatedAt(modifiedAt: number): string {
  const at = new Date(modifiedAt);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString([], today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" });
}
