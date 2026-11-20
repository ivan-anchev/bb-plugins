// Memory, at the bottom of a started regional manager's board: its memory files, each with its first
// line and when it last changed. Opening one swaps the list for the file, rendered, with the way back
// and Edit, which edits it in place (memory-editor.tsx). Each file's edit is kept, so going back, bb
// redrawing the panel or a reload loses nothing and a save still settles, and while any draft is
// open, Esc never leaves the page.
import { experimental_Icon as Icon, experimental_useRpcQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, useState } from "react";
import { coordinatorContract as contract, type MemoryEntry } from "../../contract.ts";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";
import { shortTime } from "../ui/time.ts";
import { MemoryEditor } from "./memory-editor.tsx";
import { useFileEdits } from "./use-file-edits.ts";

export function MemorySection({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const list = experimental_useRpcQuery({ contract, method: "memoryList", input: { coordinatorId } });
  // why session storage: the file this tab has open survives bb redrawing the panel and a reload, as its draft does.
  const opened = useStored(sessionStorage, openedKeyOf(coordinatorId), memoryFileSchema);
  const edits = useFileEdits(coordinatorId);
  const heading = useId();
  const entries = list.data?.files ?? [];
  const drafted = new Set(entries.flatMap(({ file }) => (edits.of(file).draft === null ? [] : [file])));
  useHoldEscape(drafted.size > 0);
  // why derived: a file deleted since it was opened shows the list again.
  const entry = entries.find(({ file }) => file === opened.value) ?? null;

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2 border-t border-border pt-6">
      <h2 id={heading} className="flex items-baseline gap-2 px-2 text-sm font-medium">
        Memory
        {list.data !== undefined && <span className="text-xs font-normal text-muted-foreground tabular-nums">{entries.length}</span>}
      </h2>
      {list.error !== null && <ReadFailure onRetry={() => void list.refetch()}>Could not read the memory folder: {list.error.message}</ReadFailure>}
      {list.data !== undefined && entries.length === 0 && <p className="px-2 text-sm text-muted-foreground">The memory folder has no files.</p>}
      {entry === null ? (
        <FileList entries={entries} drafted={drafted} onOpen={opened.store} />
      ) : (
        <OpenFile key={entry.file} coordinatorId={coordinatorId} entry={entry} edits={edits} onBack={() => opened.store(null)} />
      )}
    </section>
  );
}

/** Where a tab keeps the memory file it has open on a regional manager's board. */
const openedKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-memory-open:${coordinatorId}`;

function FileList({ entries, drafted, onOpen }: { entries: readonly MemoryEntry[]; drafted: ReadonlySet<MemoryFile>; onOpen(file: MemoryFile): void }) {
  return (
    <ul className="flex flex-col">
      {entries.map(({ file, firstLine, modifiedAt }) => (
        <li key={file}>
          <button
            type="button"
            onClick={() => onOpen(file)}
            className="flex min-h-9 w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
              {file}
              {drafted.has(file) && (
                <span className="size-1.5 rounded-full bg-foreground">
                  <span className="sr-only">, unsaved changes</span>
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{firstLine}</span>
            <time dateTime={new Date(modifiedAt).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {shortTime(modifiedAt)}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}

type OpenFileProps = { coordinatorId: CoordinatorId; entry: MemoryEntry; edits: ReturnType<typeof useFileEdits>; onBack(): void };

/** One file, rendered, with the way back to every file and Edit; or, while the user edits it, its editor. */
function OpenFile({ coordinatorId, entry: { file, modifiedAt }, edits, onBack }: OpenFileProps) {
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
        <Button variant="ghost" size="sm" onClick={onBack}>
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

function FileReader({ coordinatorId, file, modifiedAt, onEdit }: { coordinatorId: CoordinatorId; file: MemoryFile; modifiedAt: number; onEdit(): void }) {
  const read = experimental_useRpcQuery({ contract, method: "memoryRead", input: { coordinatorId, file } });
  const heading = useId();
  return (
    <article aria-labelledby={heading} className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2">
        <h3 id={heading} className="font-mono text-sm font-medium">
          {file}
        </h3>
        <time dateTime={new Date(modifiedAt).toISOString()} className="text-xs text-muted-foreground tabular-nums">
          {shortTime(modifiedAt)}
        </time>
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
