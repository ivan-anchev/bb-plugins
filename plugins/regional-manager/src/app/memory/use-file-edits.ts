import { experimental_PluginRpcCallError as RpcCallError, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { useStored } from "../ui/stored.ts";
import { draftAfter, draftsKeyOf, draftsSchema, NO_SAVE, settled, withDraft, type Draft, type FileEdit, type Save, type SaveState } from "./draft.ts";

type FileEdits = {
  of(file: MemoryFile): FileEdit;
  /** Every file with an unsaved draft, on disk or not. */
  drafted: readonly MemoryFile[];
  setDraft(file: MemoryFile, draft: Draft | null): void;
  /** Sends the save; resolves true once it is saved, false when it was refused or failed. */
  save(file: MemoryFile, save: Save): Promise<boolean>;
};

export function useFileEdits(coordinatorId: CoordinatorId): FileEdits {
  const write = experimental_useRpcMutation({ contract, method: "memoryWrite" });
  const drafts = useStored(localStorage, draftsKeyOf(coordinatorId), draftsSchema);
  const [saves, setSaves] = useState<ReadonlyMap<MemoryFile, SaveState>>(new Map());

  function updateSave(file: MemoryFile, change: (save: SaveState) => SaveState) {
    setSaves((current) => new Map(current).set(file, change(current.get(file) ?? NO_SAVE)));
  }

  async function send(file: MemoryFile, save: Save): Promise<boolean> {
    updateSave(file, (state) => ({ ...state, saving: true, failure: null }));
    try {
      const outcome = await write.mutate({ coordinatorId, file, content: save.draft.text, baseVersion: save.base });
      drafts.update((current) => withDraft(current, file, draftAfter(current?.[file] ?? null, save, outcome)));
      updateSave(file, () => settled(save, outcome));
      return outcome.outcome === "saved";
    } catch (error) {
      updateSave(file, (state) => ({ ...state, saving: false, failure: RpcCallError.from(error).message }));
      return false;
    }
  }

  return {
    of: (file) => ({ ...(saves.get(file) ?? NO_SAVE), draft: drafts.value?.[file] ?? null }),
    drafted: Object.entries(drafts.value ?? {}).flatMap(([file, draft]) => (draft === undefined ? [] : [memoryFileSchema.parse(file)])),
    setDraft: (file, draft) => drafts.update((current) => withDraft(current, file, draft)),
    save: send,
  };
}
