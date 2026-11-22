// Memory, at the bottom of a started regional manager's board: a section that folds from its header,
// as a lane does, and stays folded through a reload, showing its memory files as cards that preview
// each one (memory-card.tsx). Opening one swaps the cards for the file, rendered, with the way back
// and Edit, which edits it in place (memory-editor.tsx). Each file's edit is kept, so going back, bb
// redrawing the panel or a reload loses nothing and a save still settles; a file with a draft is
// shown even once deleted, so the draft is never hidden; and while any draft is open, Esc never
// leaves the page. Opening a file moves focus to its way back, and going back to the file's card.
import { experimental_Icon as Icon, experimental_useRpcQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, useRef, useState, type Ref } from "react";
import { z } from "zod";
import { coordinatorContract as contract, type MemoryEntry } from "../../contract.ts";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { LaneHeader } from "../ui/lane-header/lane-header.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";
import { shortTime } from "../ui/time.ts";
import { MemoryCard } from "./card/memory-card.tsx";
import { MemoryEditor } from "./memory-editor.tsx";
import { useFileEdits } from "./use-file-edits.ts";

export function MemorySection({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const list = experimental_useRpcQuery({ contract, method: "memoryList", input: { coordinatorId } });
  // why session storage: the file this tab has open survives bb redrawing the panel and a reload, as its draft does.
  const opened = useStored(sessionStorage, openedKeyOf(coordinatorId), memoryFileSchema);
  const folded = useStored(localStorage, foldedKeyOf(coordinatorId), foldedSchema);
  const edits = useFileEdits(coordinatorId);
  const ids = useId();
  const landing = useRef<Landing | null>(null);
  const drafted = new Set(edits.drafted);
  useHoldEscape(drafted.size > 0);
  // why nothing until the list is read: the header would count the files before it knows them.
  if (list.data === undefined && list.error === null) return null;
  const entries = list.data?.files ?? [];
  const rows: readonly Row[] = [...entries.map((entry) => ({ file: entry.file, entry })), ...edits.drafted.filter((file) => !entries.some((entry) => entry.file === file)).map((file) => ({ file, entry: null }))];
  // why among the rows: a file deleted since it was opened stays open while it has a draft, and shows the cards again once it has none.
  const open = rows.find(({ file }) => file === opened.value) ?? null;
  const unfolded = folded.value === null;
  const heading = `${ids}-heading`;
  /** Focuses the element once the view it is in replaces the one focus was in, if it is where focus is to land. */
  const landOn = (target: Landing) => (element: HTMLElement | null) => {
    if (element === null || landing.current === null || !sameLanding(landing.current, target)) return;
    landing.current = null;
    element.focus();
  };
  const openFile = (file: MemoryFile) => {
    landing.current = { on: "file" };
    opened.store(file);
  };
  const body = `${ids}-body`;

  return (
    <section aria-labelledby={heading} className="flex flex-col">
      <LaneHeader ref={null} id={heading} listId={body} glyph={<Icon name="Folder" className="size-3.5 text-subtle-foreground" aria-hidden />} name="Memory" count={rows.length} open={unfolded} onToggle={() => folded.store(unfolded ? true : null)} />
      {unfolded && (
        <div id={body} className="flex flex-col gap-2 pt-1">
          {list.error !== null && <ReadFailure onRetry={() => void list.refetch()}>Could not read the memory folder: {list.error.message}</ReadFailure>}
          {list.data !== undefined && rows.length === 0 && <p className="px-2 pt-1 text-sm text-muted-foreground">The memory folder has no files.</p>}
          {open === null ? (
            <FileCards rows={rows} drafted={drafted} cardRef={(file) => landOn({ on: "card", file })} onOpen={openFile} />
          ) : (
            <OpenFile
              key={open.file}
              coordinatorId={coordinatorId}
              file={open.file}
              modifiedAt={open.entry?.modifiedAt ?? null}
              edits={edits}
              backRef={landOn({ on: "file" })}
              onBack={() => {
                landing.current = { on: "card", file: open.file };
                opened.store(null);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** Where a tab keeps the memory file it has open on a regional manager's board. */
const openedKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-memory-open:${coordinatorId}`;

/** Where the browser keeps that a regional manager's Memory is folded; nothing kept: it is open. */
const foldedKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-memory-folded:${coordinatorId}`;
const foldedSchema = z.literal(true);

/**
 * Where focus lands once a view replaces the one it was in: the open file's way back, or the card of
 * the file just closed. why: the control it was on unmounts, which would drop it to the page.
 */
type Landing = { on: "file" } | { on: "card"; file: MemoryFile };
const sameLanding = (a: Landing, b: Landing): boolean => (a.on === "card" && b.on === "card" ? a.file === b.file : a.on === b.on);

/** A file the cards show: on disk, with the start of its text and when it changed (null entry: deleted since, its draft kept). */
type Row = { file: MemoryFile; entry: MemoryEntry | null };

type FileCardsProps = { rows: readonly Row[]; drafted: ReadonlySet<MemoryFile>; cardRef(file: MemoryFile): Ref<HTMLButtonElement>; onOpen(file: MemoryFile): void };

function FileCards({ rows, drafted, cardRef, onOpen }: FileCardsProps) {
  return (
    <ul className="rmi-memory-cards">
      {rows.map(({ file, entry }) => (
        <li key={file}>
          <MemoryCard ref={cardRef(file)} file={file} preview={entry?.preview ?? null} drafted={drafted.has(file)} onOpen={() => onOpen(file)} />
        </li>
      ))}
    </ul>
  );
}

/** When a file last changed. */
function Changed({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {shortTime(at)}
    </time>
  );
}

type OpenFileProps = { coordinatorId: CoordinatorId; file: MemoryFile; modifiedAt: number | null; edits: ReturnType<typeof useFileEdits>; backRef: Ref<HTMLButtonElement>; onBack(): void };

/** One file, rendered, with the way back to every file and Edit; or, while the user edits it, its editor. */
function OpenFile({ coordinatorId, file, modifiedAt, edits, backRef, onBack }: OpenFileProps) {
  const edit = edits.of(file);
  // why the draft counts: an edit left open, kept in the browser, opens in its editor again.
  const [editing, setEditing] = useState(edit.draft !== null);

  function cancel() {
    edits.setDraft(file, null);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button ref={backRef} variant="ghost" size="sm" onClick={onBack}>
          <Icon name="ArrowLeft" aria-hidden />
          All files
        </Button>
      </div>
      {editing ? (
        <MemoryEditor
          coordinatorId={coordinatorId}
          file={file}
          edit={edit}
          onDraft={(draft) => edits.setDraft(file, draft)}
          onSave={(save) => void edits.save(file, save).then((saved) => saved && setEditing(false))}
          onCancel={cancel}
        />
      ) : (
        <FileReader coordinatorId={coordinatorId} file={file} modifiedAt={modifiedAt} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

function FileReader({ coordinatorId, file, modifiedAt, onEdit }: { coordinatorId: CoordinatorId; file: MemoryFile; modifiedAt: number | null; onEdit(): void }) {
  const read = experimental_useRpcQuery({ contract, method: "memoryRead", input: { coordinatorId, file } });
  const heading = useId();
  return (
    <article aria-labelledby={heading} className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2">
        <h3 id={heading} className="font-mono text-sm font-medium">
          {file}
        </h3>
        {modifiedAt !== null && <Changed at={modifiedAt} />}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Icon name="Edit" aria-hidden />
            Edit
          </Button>
        </div>
      </div>
      {read.error !== null && (
        <ReadFailure onRetry={() => void read.refetch()}>
          Could not read {file}: {read.error.message}
        </ReadFailure>
      )}
      {read.data !== undefined && <div className="px-2">{read.data.text === null ? <p className="text-sm text-muted-foreground">{file} is no longer in the folder.</p> : <Markdown content={read.data.text.content} className="text-sm" />}</div>}
    </article>
  );
}
