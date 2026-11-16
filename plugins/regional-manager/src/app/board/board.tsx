// The board of one coordinating thread: its verification switch, a warning while its own working
// tree has changed files, why PR status is unavailable when it is, and its digest, then its
// decisions and crews grouped Needs you, Ready for review, Verifying, Working, Landing, Idle and
// Done, each group's decisions first. The Board tab in the thread and the Board page in the panel
// both draw it, from one read; each gives it the scrolling root it sits in.
import { experimental_Icon as Icon, experimental_useRpcMutation, experimental_useRpcQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, useState } from "react";
import { coordinatorContract as contract, type Board as BoardData, type BoardRow } from "../../contract.ts";
import { boardGroups, type BoardItem } from "../../model/board/board-groups.ts";
import { BOARD_STATE_LABELS, type BoardState } from "../../model/board/crew-state.ts";
import { filesText } from "../../model/inbox/own-tree.ts";
import type { Decision } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { useFocusKeptByKey } from "../ui/focus-hand-off.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { Switch } from "../ui/switch.tsx";
import { shortTime } from "../ui/time.ts";
import { CrewRow } from "./crew-row.tsx";
import { DecisionRow } from "./decision-row.tsx";
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
          {read.data.ownEdits !== null && <OwnEdits {...read.data.ownEdits} />}
          {read.data.prUnavailable !== null && <PrUnavailable reason={read.data.prUnavailable} />}
          <Digest ids={ids} digest={read.data.digest} />
          <Groups ids={ids} coordinatorId={coordinatorId} decisions={read.data.decisions} rows={read.data.rows} />
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
            ? `A hidden verifier, on another model when there is one, checks each done handoff against its criteria before the regional manager hears of it.`
            : `Done handoffs reach the regional manager unverified. Turning this on checks handoffs from then on.`
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

/**
 * Files changed in the coordinating thread's own working tree when a turn of its ended. Its rules
 * say it never edits project files, and bb can't stop it, so the plugin tells it and the user. It
 * goes once a turn of its ends with the tree clean.
 */
function OwnEdits({ fileCount, at }: NonNullable<BoardData["ownEdits"]>) {
  return (
    <p className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">
          {filesText(fileCount)} changed in the regional manager's own environment
        </span>{" "}
        when its turn ended at <time dateTime={new Date(at).toISOString()}>{shortTime(at)}</time>. Its rules forbid editing project files, so it was told to hand the change to a crew.
      </span>
    </p>
  );
}

/**
 * Why the plugin can't read its crews' pull requests now. Rows keep the PR and CI it read last, and a
 * pass it couldn't check CI for says so.
 */
function PrUnavailable({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">PR status unavailable:</span> {reason}. Rows show what was read last.
      </span>
    </p>
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
            Updated {shortTime(digest.modifiedAt)}
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

type GroupsProps = { ids: string; coordinatorId: CoordinatorId; decisions: readonly Decision[]; rows: readonly BoardRow[] };

function Groups({ ids, coordinatorId, decisions, rows }: GroupsProps) {
  const keepFocus = useFocusKeptByKey();
  return (
    <>
      {boardGroups(decisions, rows).map(({ state, rows: inState }) => (
        <section key={state} aria-labelledby={`${ids}-${state}`} className="flex flex-col gap-1">
          <h2 id={`${ids}-${state}`} className="flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
            <span aria-hidden className={`size-1.5 rounded-full ${DOT[state]}`} />
            {BOARD_STATE_LABELS[state]}
            <span className="tabular-nums">{inState.length}</span>
          </h2>
          <ul className="flex flex-col">
            {inState.map((item) => (
              <li key={item.kind === "decision" ? item.decision.id : item.row.crewId}>
                <ItemRow item={item} coordinatorId={coordinatorId} keepFocus={keepFocus} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.length === 0 && <p className="px-2 text-sm text-muted-foreground">No crews yet. The regional manager starts one for each piece of work it delegates.</p>}
    </>
  );
}

/** One row, keeping focus as it moves between groups: decision and crew ids never collide (`d1`, `c1`). */
function ItemRow({ item, coordinatorId, keepFocus }: { item: BoardItem<BoardRow>; coordinatorId: CoordinatorId; keepFocus: ReturnType<typeof useFocusKeptByKey> }) {
  switch (item.kind) {
    case "decision":
      return <DecisionRow ref={keepFocus(item.decision.id)} coordinatorId={coordinatorId} decision={item.decision} />;
    case "crew": {
      const row = item.row;
      if (row.draft !== null) return <DraftRow ref={keepFocus(row.crewId)} coordinatorId={coordinatorId} row={row} draft={row.draft} />;
      return (
        <>
          <CrewRow ref={keepFocus(row.crewId)} row={row} />
          <DroppedEdit coordinatorId={coordinatorId} row={row} />
        </>
      );
    }
    default:
      return item satisfies never;
  }
}

const DOT: Record<BoardState, string> = {
  "needs-you": "bg-warning",
  "ready-for-review": "bg-pr-merged",
  verifying: "bg-attention",
  working: "bg-success",
  landing: "bg-primary",
  idle: "bg-muted-foreground",
  done: "border border-muted-foreground",
};
