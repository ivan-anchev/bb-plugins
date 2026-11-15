// Delete from the picking footer: the picked notes and their files go for good, in one call.
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // runtime-shimmed to bb's own toast
import { notesContract as contract, type Note } from "../../contract.ts";

export function useDeleteNotes() {
  const remove = experimental_useRpcMutation({ contract, method: "deleteNotes" });

  /**
   * Success toasts and the rows leave every list; a failure keeps the notes and says why. Resolves
   * whether the notes were deleted, and never rejects.
   */
  const run = (noteIds: readonly Note["id"][]): Promise<boolean> =>
    remove.mutate({ noteIds: [...noteIds] }).then(
      () => {
        toast.success(noteIds.length === 1 ? "Note deleted" : `${noteIds.length} notes deleted`);
        return true;
      },
      // why swallowed: the hook keeps the failure in `error`, which the panel shows.
      () => false,
    );

  return { error: remove.error?.message ?? null, run };
}
