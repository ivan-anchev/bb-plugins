// A crew's current handoff: its latest one, as long as its thread has started no turn since. The
// board, crew_read and the idle watcher all ask here, so "current" has one meaning.
import type { Crew } from "../../model/crew.ts";
import { handoffIsCurrent, type Handoff } from "../../model/handoff.ts";
import type { Store } from "../store.ts";

/** The part of bb a turn read uses: the thread's newest `turn/started` event. */
export type TurnsBb = {
  sdk: { threads: { events: { list(args: { threadId: string; types: ["turn/started"]; order: "desc"; limit: string }): Promise<{ seq: number }[]> } } };
};

/** The sequence of the thread's latest `turn/started` event; null when bb lists none. */
export async function latestTurnSeq(bb: TurnsBb, threadId: string): Promise<number | null> {
  const [latest] = await bb.sdk.threads.events.list({ threadId, types: ["turn/started"], order: "desc", limit: "1" });
  return latest?.seq ?? null;
}

/** The crew's latest handoff if it is current, else null. Reads bb only when there is a handoff to judge. */
export async function currentHandoff(bb: TurnsBb, store: Pick<Store, "latestHandoff">, crew: Crew & { launch: { kind: "started" } }): Promise<Handoff | null> {
  const handoff = store.latestHandoff(crew.coordinatorId, crew.id);
  if (handoff === null) return null;
  return handoffIsCurrent(handoff, await latestTurnSeq(bb, crew.launch.threadId)) ? handoff : null;
}
