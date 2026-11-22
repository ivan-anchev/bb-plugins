import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { notesContract as contract, type Note } from "../../contract.ts";

export function useDeleteNotes() {
  const remove = experimental_useRpcMutation({ contract, method: "deleteNotes" });

  const run = (noteIds: readonly Note["id"][]): Promise<boolean> =>
    remove.mutate({ noteIds: [...noteIds] }).then(
      () => {
        toast.success(noteIds.length === 1 ? "Note deleted" : `${noteIds.length} notes deleted`);
        return true;
      },
      () => false,
    );

  return { error: remove.error?.message ?? null, run };
}
