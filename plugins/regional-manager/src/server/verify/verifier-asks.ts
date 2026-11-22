import { isNamespaced, questionOf, type InteractionPayload } from "../../model/interaction.ts";

type Pending = { id: string; status: string; payload: InteractionPayload };

type Target = { threadId: string; interactionId: string };

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
      payload satisfies never;
      return interactions.cancel(target);
  }
}
