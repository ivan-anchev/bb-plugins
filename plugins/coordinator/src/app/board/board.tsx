// The board of one coordinating thread: its verification switch and its digest, then its crews
// grouped Needs you, Ready for review, Verifying, Working, Idle and Done. The Board tab in the thread and the Board page in the panel both
// draw it, from one read; each gives it the scrolling root it sits in.
import { experimental_useRpcMutation, experimental_useRpcQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, useState } from "react";
import { coordinatorContract as contract, type Board as BoardData, type BoardRow } from "../../contract.ts";
import { BOARD_STATE_LABELS, byState, type BoardState } from "../../model/crew-state.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { useFocusKeptByKey } from "../ui/focus-hand-off.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { Switch } from "../ui/switch.tsx";
import { CrewRow } from "./crew-row.tsx";
import { DraftRow } from "./draft/draft-row.tsx";
import { DroppedEdit } from "./draft/dropped-edit.tsx";

export function Board({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const read = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } });
  // why: each heading labels its section by id, and a page may show more than one board.
  const ids = useId();
  return (
    // why a container: the board is as narrow as a side panel in the Board tab, whatever the window's width.
    <div className="@container flex flex-col gap-6">
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
      {read.data === undefined && read.error === null && <p className="px-2 text-sm text-muted-foreground">Loading the board…</p>}
      {read.data !== undefined && (
        <>
          <VerifySwitch coordinatorId={coordinatorId} verify={read.data.verify} />
          <Digest ids={ids} digest={read.data.digest} />
          <Crews ids={ids} coordinatorId={coordinatorId} rows={read.data.rows} />
        </>
      )}
    </div>
  );
}

/**
 * The board's switch for verifying done handoffs. It shows what the user asked for while the change
 * saves, and the stored value once the board reads it back.
 */
function VerifySwitch({ coordinatorId, verify }: { coordinatorId: CoordinatorId; verify: boolean }) {
  const save = experimental_useRpcMutation({ contract, method: "setVerify" });
  const [asked, setAsked] = useState<boolean | null>(null);
  // why during render: once the board reads back what was asked, the stored value takes over.
  if (asked !== null && asked === verify) setAsked(null);
  const shown = asked ?? verify;

  function change(next: boolean) {
    setAsked(next);
    save.mutate({ coordinatorId, verify: next }).catch(() => setAsked(null));
  }

  return (
    <div className="flex flex-col gap-1 px-2">
      <Switch
        checked={shown}
        onChange={change}
        pending={save.isPending}
        label="Verify done handoffs"
        hint={
          shown
            ? `A hidden verifier, on another model when there is one, checks each done handoff against its criteria before the ${DISPLAY_NAME} hears of it.`
            : `Done handoffs reach the ${DISPLAY_NAME} unverified. Turning this on checks handoffs from then on.`
        }
      />
      {save.error !== null && (
        <p role="alert" className="pl-11 text-xs text-destructive-text">
          Could not change it: {save.error.message}
        </p>
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
                <CrewRow ref={keepFocus(row.crewId)} row={row} />
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
  verifying: "bg-attention",
  working: "bg-success",
  idle: "bg-muted-foreground",
  done: "border border-muted-foreground",
};

/** The time the digest changed: today's as a time, an older one with its date. */
function updatedAt(modifiedAt: number): string {
  const at = new Date(modifiedAt);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString([], today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" });
}
