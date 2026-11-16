// One memory file in the Memory editor. A save names the version the user started from, so it never
// silently replaces a write it didn't see: when the file moved on, the user's text stays and the
// newer version shows beside it.
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useCallback, useId, useRef, type KeyboardEvent, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { editorState, fileNow, isSaved, saveOf, typed, type Draft, type EditorState, type FileEdit, type Save } from "./draft.ts";

type MemoryEditorProps = {
  coordinatorId: CoordinatorId;
  file: MemoryFile;
  /** The user's edit of this file; kept by the page, so switching files keeps it. */
  edit: FileEdit;
  onDraft(draft: Draft | null): void;
  /** Sends a save; the page runs it, so its answer lands even if this editor has gone. */
  onSave(save: Save): void;
};

const TEXT_CLASS =
  "min-h-80 w-full flex-1 resize-none rounded-md border border-border p-3 font-mono text-base leading-6 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-[13px] md:leading-5";

export function MemoryEditor({ coordinatorId, file, edit, onDraft, onSave }: MemoryEditorProps) {
  const read = experimental_useRpcQuery({ contract, method: "memoryRead", input: { coordinatorId, file } });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const heading = useId();
  // why: the conflict's own controls leave once a save starts or the user takes the newer version;
  // focus in them moves to the user's text, which stays (REVIEW.md).
  const handsFocusToText = useCallback((region: HTMLElement | null) => {
    if (region === null) return;
    return () => {
      if (region.contains(document.activeElement)) textarea.current?.focus();
    };
  }, []);

  if (read.data === undefined) {
    return read.error === null ? (
      <p className="px-1 text-sm text-muted-foreground">Reading {file}…</p>
    ) : (
      <ReadFailure onRetry={() => void read.refetch()}>
        Could not read {file}: {read.error.message}
      </ReadFailure>
    );
  }

  const lastRead = read.data;
  const current = fileNow(lastRead, edit);
  const state = editorState(current.text, edit.draft);
  // why: while a save is out, the read may already show the version it wrote, which isn't a conflict.
  const view = edit.saving && state.kind === "conflict" ? { kind: "edited" as const, draft: state.draft } : state;
  const text = view.kind === "clean" ? view.text : view.draft.text;

  function save() {
    const request = saveOf(lastRead, edit);
    if (request !== null) onSave(request);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    save();
  }

  return (
    <section aria-labelledby={heading} onKeyDown={onKeyDown} className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={heading} className="font-mono text-sm font-medium">
          {file}
        </h2>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {statusOf(view.kind, { saving: edit.saving, saved: isSaved(current, edit), exists: current.text !== null })}
        </p>
        <div className="ml-auto">
          {/* why aria-disabled: a disabled button drops focus to the page when a save ends. */}
          <Button variant="default" size="sm" aria-disabled={view.kind === "clean"} onClick={save}>
            {view.kind === "conflict" && view.newer !== null ? "Save mine over it" : "Save"}
          </Button>
        </div>
      </div>
      {read.error !== null && (
        <ReadFailure onRetry={() => void read.refetch()}>
          Could not read the latest {file}: {read.error.message}
        </ReadFailure>
      )}
      {edit.failure !== null && (
        <p role="alert" className="px-1 text-sm text-destructive-text">
          Could not save {file}: {edit.failure}. Your text is still here.
        </p>
      )}
      {view.kind === "conflict" && <ConflictNotice ref={handsFocusToText} file={file} deleted={view.newer === null} onTakeNewer={() => onDraft(null)} />}
      <div className={view.kind === "conflict" && view.newer !== null ? "grid flex-1 gap-3 md:grid-cols-2" : "flex flex-1 flex-col"}>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={view.kind === "conflict" ? "px-1 text-xs font-medium text-muted-foreground" : "sr-only"}>{view.kind === "conflict" ? "Your text" : file}</span>
          <textarea
            ref={textarea}
            value={text}
            readOnly={edit.saving}
            spellCheck={false}
            onChange={(event) => onDraft(typed(event.target.value, current.text, edit.draft))}
            className={`${TEXT_CLASS} bg-background`}
          />
        </label>
        {view.kind === "conflict" && view.newer !== null && (
          <label ref={handsFocusToText} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="px-1 text-xs font-medium text-muted-foreground">Newer version</span>
            <textarea value={view.newer.content} readOnly spellCheck={false} className={`${TEXT_CLASS} bg-muted text-muted-foreground`} />
          </label>
        )}
      </div>
    </section>
  );
}

type ConflictNoticeProps = { ref: Ref<HTMLDivElement>; file: MemoryFile; deleted: boolean; onTakeNewer(): void };

function ConflictNotice({ ref, file, deleted, onTakeNewer }: ConflictNoticeProps) {
  return (
    // why on the page's surface: muted text, as on the button, fails contrast on bg-muted in dark themes.
    <div ref={ref} role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
      <Icon name="GitMerge" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-pretty">
        {deleted
          ? `${file} was deleted since you started editing. Your text is kept; saving creates the file again.`
          : `${file} changed since you started editing. Your text is kept, with the newer version beside it: copy what you need into yours, then save.`}
      </p>
      {!deleted && (
        <Button variant="ghost" size="sm" onClick={onTakeNewer}>
          Use the newer version
        </Button>
      )}
    </div>
  );
}

function statusOf(kind: EditorState["kind"], { saving, saved, exists }: { saving: boolean; saved: boolean; exists: boolean }): string {
  if (saving) return "Saving…";
  switch (kind) {
    case "clean":
      if (!exists) return "Not in the folder yet. Saving creates it.";
      return saved ? "Saved" : "";
    case "edited":
    case "conflict":
      return "Unsaved changes";
  }
}
