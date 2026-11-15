// The active notes, from bb's shared query cache: the card and the popover read the same
// list, so one read serves both and a delete anywhere refreshes both.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { notesContract } from "../contract.ts";

export function useNotes() {
  return experimental_useRpcQuery({ contract: notesContract, method: "notes", input: {} });
}
