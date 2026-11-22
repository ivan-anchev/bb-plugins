// What a verifier's provider asks a person, settled at once. Nobody answers a verifier: it is
// hidden, and its regional manager hears of it only through its verdict. An ask left pending holds
// its turn active, so the check would wait for a verdict that never comes (seen live: a codex
// verifier's GitHub connector asking to reconnect, thr_e7hmzb5wjd). Each is declined so the
// verifier goes on without it and says in its verdict what it couldn't check.
import { isNamespaced, questionOf, type InteractionPayload } from "../../model/interaction.ts";

type Pending = { id: string; status: string; payload: InteractionPayload };

type Target = { threadId: string; interactionId: string };

/** The answer a verifier's question gets, in place of a person's. */
const NOBODY_ANSWERS = "Nobody answers a verifier: go on without an answer, and say in your verdict what you couldn't check because of it.";

/** The part of bb declining uses: a thread's interactions, and each way it takes a no. */
export type AsksBb = {
  sdk: {
    threads: {
      interactions: {
        list(args: { threadId: string }): Promise<Pending[]>;
        resolve(
          args: Target & { resolution: { decision: "deny" } | { kind: "user_answer"; answers: Record<string, { selected: string[]; freeText: string }> } },
        ): Promise<unknown>;
        respond(args: Target & { value: { action: "decline" } }): Promise<unknown>;
        cancel(args: Target): Promise<unknown>;
      };
    };
  };
};

/** One ask the plugin declined: what it asked, and bb's refusal to take the no (null: taken). */
export type Declined = { asked: string; refused: string | null };

/** Declines every ask pending in the thread, each as its kind takes a no (see declineOne). */
export async function declineAsks(bb: AsksBb, threadId: string): Promise<Declined[]> {
  const pending = (await bb.sdk.threads.interactions.list({ threadId })).filter(({ status }) => status === "pending");
  return Promise.all(
    pending.map(async ({ id: interactionId, payload }): Promise<Declined> => {
      const asked = questionOf(payload);
      try {
        await declineOne(bb, { threadId, interactionId }, payload);
        return { asked, refused: null };
      } catch (error) {
        return { asked, refused: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

/**
 * Says no to one ask. why each its own way: bb takes a cancel only for an ask a plugin raised
 * (seen live: "Plugin interaction expected" for a Claude Code question). An approval is denied, as
 * "don't run it". A question is answered that nobody answers, as a person's free text, since it
 * has no "no" of its own. A provider's own request (codex's MCP elicitation, a connector's
 * sign-in) is answered as MCP declines one.
 */
function declineOne(bb: AsksBb, target: Target, payload: InteractionPayload): Promise<unknown> {
  const { interactions } = bb.sdk.threads;
  switch (payload.kind) {
    case "approval":
      return interactions.resolve({ ...target, resolution: { decision: "deny" } });
    case "user_question":
      return interactions.resolve({
        ...target,
        resolution: { kind: "user_answer", answers: Object.fromEntries(payload.questions.map(({ id }) => [id, { selected: [], freeText: NOBODY_ANSWERS }])) },
      });
    case "plugin":
      return interactions.cancel(target);
    default:
      if (isNamespaced(payload)) return interactions.respond({ ...target, value: { action: "decline" } });
      // why cancel an ask newer than this plugin's SDK: its fields are unknown, and a refusal ends the check, naming it.
      payload satisfies never;
      return interactions.cancel(target);
  }
}
