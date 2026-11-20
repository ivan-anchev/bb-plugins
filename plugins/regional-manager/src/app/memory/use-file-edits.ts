// Every memory file's edit in the board's Memory. The drafts are kept in the browser, so bb redrawing
// the panel or a reload loses none; the section owns the saves, and switching files unmounts an editor
// but not its save, whose answer settles the file it was made for.
import { experimental_PluginRpcCallError as RpcCallError, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { useStored } from "../ui/stored.ts";
import { draftAfter, draftsKeyOf, draftsSchema, NO_SAVE, settled, withDraft, type Draft, type FileEdit, type Save, type SaveState } from "./draft.ts";

type FileEdits = {
  of(file: MemoryFile): FileEdit;
  setDraft(file: MemoryFile, draft: Draft | null): void;
  /** Sends the save; resolves true once it is saved, false when it was refused or failed. */
  save(file: MemoryFile, save: Save): Promise<boolean>;
};

export function useFileEdits(coordinatorId: CoordinatorId): FileEdits {
  const write = experimental_useRpcMutation({ contract, method: "memoryWrite" });
  // why local, not session, storage: every tab shows the one draft, so no tab saves over another's unseen.
  const drafts = useStored(localStorage, draftsKeyOf(coordinatorId), draftsSchema);
  const [saves, setSaves] = useState<ReadonlyMap<MemoryFile, SaveState>>(new Map());

  function updateSave(file: MemoryFile, change: (save: SaveState) => SaveState) {
    setSaves((current) => new Map(current).set(file, change(current.get(file) ?? NO_SAVE)));
  }

  // why no abort: the write is the server's once sent. Leaving the page drops every save, and with
  // them the only state this answer would settle, but not the draft, which it settles in the browser.
  async function send(file: MemoryFile, save: Save): Promise<boolean> {
    updateSave(file, (state) => ({ ...state, saving: true, failure: null }));
    try {
      const outcome = await write.mutate({ coordinatorId, file, content: save.draft.text, baseVersion: save.base });
      // why the stored draft, not this render's: the user may have typed on since, here or in another tab.
      drafts.update((current) => withDraft(current, file, draftAfter(current?.[file] ?? null, save, outcome)));
      updateSave(file, () => settled(save, outcome));
      return outcome.outcome === "saved";
    } catch (error) {
      // A failed save keeps the draft; the failure says why, beside the text.
      updateSave(file, (state) => ({ ...state, saving: false, failure: RpcCallError.from(error).message }));
      return false;
    }
  }

  return {
    of: (file) => ({ ...(saves.get(file) ?? NO_SAVE), draft: drafts.value?.[file] ?? null }),
    setDraft: (file, draft) => drafts.update((current) => withDraft(current, file, draft)),
    save: send,
  };
}
