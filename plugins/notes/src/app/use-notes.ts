import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { notesContract } from "../contract.ts";

export function useNotes() {
  return experimental_useRpcQuery({ contract: notesContract, method: "notes", input: {} });
}

/** The drafts notes wait in (use-start-thread.ts), each with its brief and its notes. */
export function useInDrafts() {
  return experimental_useRpcQuery({ contract: notesContract, method: "inDrafts", input: {} });
}
