// What a verifier's provider asks a person, settled at once. Nobody answers a verifier: it is
// hidden, and its regional manager hears of it only through its verdict. An ask left pending holds
// its turn active, so the check would wait for a verdict that never comes (seen live: a codex
// verifier's GitHub connector asking to reconnect, thr_e7hmzb5wjd). Each is declined so the
// verifier goes on without it and says in its verdict what it couldn't check.
import { questionOf, type InteractionPayload } from "../../model/interaction.ts";

type Pending = { id: string; status: string; payload: InteractionPayload };

/** The part of bb declining uses: a thread's interactions, and the two ways to say no. */
export type AsksBb = {
  sdk: {
    threads: {
      interactions: {
        list(args: { threadId: string }): Promise<Pending[]>;
        resolve(args: { threadId: string; interactionId: string; resolution: { decision: "deny" } }): Promise<unknown>;
        cancel(args: { threadId: string; interactionId: string }): Promise<unknown>;
      };
    };
  };
};

/** One ask the plugin declined: what it asked, and bb's refusal to take the no (null: taken). */
export type Declined = { asked: string; refused: string | null };

/**
 * Declines every ask pending in the thread. why deny an approval: its provider takes that as "don't
 * run it" and goes on. why cancel any other (a question, an MCP elicitation): it has no "no" of its
 * own, and a provider takes a cancel as "nobody answered", failing only the call that asked.
 */
export async function declineAsks(bb: AsksBb, threadId: string): Promise<Declined[]> {
  const pending = (await bb.sdk.threads.interactions.list({ threadId })).filter(({ status }) => status === "pending");
  return Promise.all(
    pending.map(async ({ id: interactionId, payload }): Promise<Declined> => {
      const asked = questionOf(payload);
      try {
        if (payload.kind === "approval") await bb.sdk.threads.interactions.resolve({ threadId, interactionId, resolution: { decision: "deny" } });
        else await bb.sdk.threads.interactions.cancel({ threadId, interactionId });
        return { asked, refused: null };
      } catch (error) {
        return { asked, refused: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
