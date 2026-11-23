// A comment on an issue: the user's, from the issue's tab, or a reply from its regional manager or
// the agent holding it, posted with issue_comment. Every comment of the user's goes to the regional
// manager, which replies, records a decision, or tells the agent itself; none goes to an agent's
// thread on its own.
import { z } from "zod";
import { agentIdSchema } from "../agent/agent.ts";
import { answerSchema } from "../decision.ts";
import { issueIdSchema } from "../issue/issue.ts";

export const commentIdSchema = z.string().regex(/^m[1-9][0-9]*$/, "A comment id is m1, m2 and so on").brand<"commentId">();
export type CommentId = z.infer<typeof commentIdSchema>;

/** What a comment says: an answer's bounds, as the user types both in the same kind of field. */
export const commentTextSchema = answerSchema;

/** Who wrote a comment: the user, the regional manager, or one of its agents. */
export const commentAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("manager") }),
  z.object({ kind: z.literal("agent"), agentId: agentIdSchema }),
]);
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

/** A comment as stored, read in the feed and in crew_catch_up: the comment it answers is one of the same issue's (null: none). */
export const commentSchema = z.object({
  id: commentIdSchema,
  issueId: issueIdSchema,
  at: z.number(),
  text: commentTextSchema,
  replyTo: commentIdSchema.nullable(),
  author: commentAuthorSchema,
});
export type Comment = z.infer<typeof commentSchema>;
