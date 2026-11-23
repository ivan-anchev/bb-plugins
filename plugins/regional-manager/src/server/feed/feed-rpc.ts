// The feed's RPC, for a started regional manager: an issue's feed, the bodies of the rounds opened
// in it, and the user's comments posted there.
import { experimental_PluginRpcRefusal as Refusal, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { parseRoundBodyKey, type coordinatorContract } from "../../contract.ts";
import type { RoundBody } from "../../model/feed/round.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import type { FeedReader } from "./feed-reader.ts";

type Deps = { store: Pick<Store, "coordinator" | "issue">; reader: FeedReader; inbox: Pick<Inbox, "commentIssue"> };

type FeedMethods = "issueFeed" | "roundBodies" | "commentIssue";

export function feedHandlers({ store, reader, inbox }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, FeedMethods>> {
  const started = (id: CoordinatorId): boolean => store.coordinator(id) !== null;

  return {
    issueFeed: async ({ coordinatorId, issueId }) => {
      if (!started(coordinatorId)) throw new Refusal({ code: "not_found", message: `There is no started regional manager ${coordinatorId}.` });
      const feed = await reader.feed(coordinatorId, issueId);
      if (feed === null) throw new Refusal({ code: "not_found", message: `This regional manager has no issue ${issueId}.` });
      return feed;
    },

    // why each key answered alone, null for one that names nothing: one stale key, as a manager removed, must not fail the reader's other rounds.
    roundBodies: ({ keys }) =>
      Object.fromEntries(
        keys.map((key) => {
          const named = parseRoundBodyKey(key);
          const body: RoundBody | null = named === null || !started(named.coordinatorId) ? null : reader.body(named.coordinatorId, named.issueId, named.round);
          return [key, body] as const;
        }),
      ),

    commentIssue: ({ coordinatorId, issueId, text, replyTo }) => {
      if (!started(coordinatorId)) throw new Refusal({ code: "not_found", message: `There is no started regional manager ${coordinatorId}.` });
      if (store.issue(coordinatorId, issueId) === null) throw new Refusal({ code: "not_found", message: `This regional manager has no issue ${issueId}.` });
      const commentId = inbox.commentIssue(coordinatorId, { issueId, author: { kind: "user" }, text, replyTo });
      if (commentId === null) throw new Refusal({ code: "not_found", message: `${replyTo} is no comment on ${issueId}, so nothing was posted.` });
      return { commentId };
    },
  };
}
