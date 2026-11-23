// issue_comment: a comment on an issue, shown on its tab, from its regional manager or from the
// agent holding it, as a reply to the user's comments there or to each other's. The caller's role
// comes from the plugin's database by its thread id, never its metadata, and decides who it posts as.
import { z } from "zod";
import { holderOf } from "../../model/agent/agent.ts";
import { commentIdSchema, commentTextSchema, type CommentAuthor } from "../../model/feed/comment.ts";
import { issueIdSchema, type IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { agentOf, failed, type ToolsBb } from "../tools/tool-kit.ts";

export const COMMENT = "issue_comment";

type Deps = { store: Pick<Store, "roleOfThread" | "issue" | "agent" | "agents">; inbox: Pick<Inbox, "commentIssue"> };

export function registerCommentTool(bb: ToolsBb, { store, inbox }: Deps): void {
  /** Who the caller posts on `issueId` as, or why it can't post there. */
  function posterOf(role: Role | null, issueId: IssueId): { coordinatorId: CoordinatorId; author: CommentAuthor } | { refused: string } {
    if (role === null) return { refused: `this thread is not a regional manager, nor an agent of one. ${ONLY_THESE}` };
    switch (role.kind) {
      case "coordinator":
        return store.issue(role.coordinatorId, issueId) === null ? { refused: `you have no issue ${issueId}. crew_catch_up lists your issues.` } : { coordinatorId: role.coordinatorId, author: { kind: "manager" } };
      case "agent": {
        if (holderOf(store.agents(role.coordinatorId), issueId)?.id === role.agentId) return { coordinatorId: role.coordinatorId, author: { kind: "agent", agentId: role.agentId } };
        // why the caller's own row: it says why it doesn't hold the issue.
        const agent = agentOf(store, role);
        return { refused: agent.ended === null ? `you hold ${agent.issueId}, not ${issueId}. ${ONLY_THESE}` : `you no longer hold ${agent.issueId} (you were ${agent.ended.how}). ${ONLY_THESE}` };
      }
      case "verifier":
      case "reviewer":
        return { refused: `this thread is a ${role.kind} of ${role.issueId}, and reports only through its own tool. ${ONLY_THESE}` };
      default:
        return role satisfies never;
    }
  }

  bb.agents.registerTool({
    name: COMMENT,
    description:
      "Comment on an issue, on its tab beside the user's comments: as its regional manager, or as the agent holding it. Give replyTo to answer one comment, such as the user's question. The user reads it there; an agent's comment also reaches its regional manager in its next catch-up, without waking it.",
    presentation: { label: { pending: "Commenting", completed: "Commented" }, icon: { glyph: "MessageSquare" } },
    parameters: z.object({
      issue: issueIdSchema.describe("The issue to comment on, such as BBP-4."),
      text: commentTextSchema.describe("What you say, in plain words."),
      replyTo: commentIdSchema.optional().describe("The id of the comment on the same issue you answer, such as m3. Leave it out for a comment of your own."),
    }),
    execute: ({ issue, text, replyTo }, { threadId }) => {
      const poster = posterOf(store.roleOfThread(threadId), issue);
      if ("refused" in poster) return failed(`${COMMENT} is refused, and nothing was posted: ${poster.refused}`);
      const id = inbox.commentIssue(poster.coordinatorId, { issueId: issue, author: poster.author, text, replyTo: replyTo ?? null });
      if (id === null) return failed(`${COMMENT} is refused, and nothing was posted: ${replyTo} is no comment on ${issue}. Leave replyTo out, or give a comment of ${issue}'s.`);
      return poster.author.kind === "agent" ? `Posted ${id} on ${issue}. The user reads it on the issue's tab, and your regional manager in its next catch-up.` : `Posted ${id} on ${issue}. The user reads it on the issue's tab.`;
    },
  });
}

const ONLY_THESE = "Only an issue's regional manager, and the agent holding it now, comment on it.";
