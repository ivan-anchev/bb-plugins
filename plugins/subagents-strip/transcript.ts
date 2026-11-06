// The transcript tab's address: which registered tab it is, and the params
// that name its delegate. Open thread writes them; bb persists them as JSON
// and hands them back to the tab, which parses them here.
import type { ExperimentalTabReference, JsonValue } from "@get-bb/plugin-sdk/app";
import type { DelegateId } from "./delegate.ts";

/** The side-panel tab one delegate's transcript opens in; equal params focus the open one. */
export const TRANSCRIPT_TAB = {
  id: "transcript",
  context: { kind: "thread" },
  availability: "action",
} as const satisfies ExperimentalTabReference;

type TranscriptParams = { delegateId: DelegateId };

export function transcriptParams(delegateId: DelegateId): TranscriptParams {
  return { delegateId };
}

/** The delegate a tab's persisted params name, or null when they name none. */
export function parseTranscriptParams(params: JsonValue | null): DelegateId | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { delegateId } = params;
  // why: bb returns the params transcriptParams wrote, so a non-empty string here is a delegate's id.
  return typeof delegateId === "string" && delegateId !== "" ? (delegateId as DelegateId) : null;
}
