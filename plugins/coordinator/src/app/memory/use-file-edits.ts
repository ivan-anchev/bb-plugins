// Every memory file's edit on the Memory page. The page owns them, and so their saves: switching
// files unmounts an editor but not its save, whose answer settles the file it was made for.
import { experimental_PluginRpcCallError as RpcCallError, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { NO_EDIT, settled, type Draft, type FileEdit, type Save } from "./draft.ts";

type FileEdits = {
  of(file: MemoryFile): FileEdit;
  /** The files with unsaved text. */
  drafted: ReadonlySet<MemoryFile>;
  setDraft(file: MemoryFile, draft: Draft | null): void;
  save(file: MemoryFile, save: Save): void;
};

export function useFileEdits(coordinatorId: CoordinatorId): FileEdits {
  const write = experimental_useRpcMutation({ contract, method: "memoryWrite" });
  const [edits, setEdits] = useState<ReadonlyMap<MemoryFile, FileEdit>>(new Map());

  function update(file: MemoryFile, change: (edit: FileEdit) => FileEdit) {
    setEdits((current) => new Map(current).set(file, change(current.get(file) ?? NO_EDIT)));
  }

  // why no abort: the write is the server's once sent. Leaving the page drops every edit, and with
  // them the only state this answer would settle.
  async function send(file: MemoryFile, save: Save) {
    update(file, (edit) => ({ ...edit, saving: true, failure: null }));
    try {
      const outcome = await write.mutate({ coordinatorId, file, content: save.draft.text, baseVersion: save.base });
      update(file, (edit) => settled(edit, save, outcome));
    } catch (error) {
      // A failed save keeps the draft; the failure says why, beside the text.
      update(file, (edit) => ({ ...edit, saving: false, failure: RpcCallError.from(error).message }));
    }
  }

  return {
    of: (file) => edits.get(file) ?? NO_EDIT,
    drafted: new Set([...edits].filter(([, edit]) => edit.draft !== null).map(([file]) => file)),
    setDraft: (file, draft) => update(file, (edit) => ({ ...edit, draft })),
    save: (file, save) => void send(file, save),
  };
}
