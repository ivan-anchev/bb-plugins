// A PR's timeline as GitHub's GraphQL API serves it: the query, limited to the item types the
// Summary tab shows, and the parse into the canonical timeline items. gh.ts runs the queries.
// Pure.
import { z } from "zod";
import type { ReviewThread } from "../comments/thread-schema.ts";
import type { ReviewVerdict, StatusChange, TimelineItem } from "../comments/timeline-schema.ts";
import { ghLabelSchema } from "./label.ts";
import { COMMENT_FIELDS, connectionOf, ghCommentSchema, PAGE, PR, pullRequestOf, toComment, type Connection } from "./pr-comments.ts";

// Every type GitHub's Conversation tab shows. The rest (subscriptions, mentions, deployments …)
// never reach the parse.
const ITEM_TYPES = [
  "ISSUE_COMMENT",
  "PULL_REQUEST_REVIEW",
  "PULL_REQUEST_COMMIT",
  "LABELED_EVENT",
  "UNLABELED_EVENT",
  "RENAMED_TITLE_EVENT",
  "REVIEW_REQUESTED_EVENT",
  "REVIEW_REQUEST_REMOVED_EVENT",
  "REVIEW_DISMISSED_EVENT",
  "ASSIGNED_EVENT",
  "UNASSIGNED_EVENT",
  "MILESTONED_EVENT",
  "DEMILESTONED_EVENT",
  "MERGED_EVENT",
  "HEAD_REF_FORCE_PUSHED_EVENT",
  "BASE_REF_CHANGED_EVENT",
  "CROSS_REFERENCED_EVENT",
  "READY_FOR_REVIEW_EVENT",
  "CONVERT_TO_DRAFT_EVENT",
  "CLOSED_EVENT",
  "REOPENED_EVENT",
  "HEAD_REF_DELETED_EVENT",
  "HEAD_REF_RESTORED_EVENT",
  "AUTO_MERGE_ENABLED_EVENT",
  "AUTO_MERGE_DISABLED_EVENT",
];

const EVENT = "createdAt actor { login }";
const REVIEWER = "requestedReviewer { ... on Actor { login } ... on Team { name } }";
const REVIEW_COMMENT_IDS = "pageInfo { hasNextPage endCursor } nodes { databaseId }";
const SOURCE = "number title url repository { nameWithOwner }";

export const TIMELINE_QUERY = `${PR} timelineItems(first: ${PAGE}, after: $cursor, itemTypes: [${ITEM_TYPES.join(", ")}]) {
  pageInfo { hasNextPage endCursor } nodes { __typename ... on Node { id }
  ... on IssueComment { ${COMMENT_FIELDS} }
  ... on PullRequestReview { ${COMMENT_FIELDS} state submittedAt comments(first: ${PAGE}) { ${REVIEW_COMMENT_IDS} } }
  ... on PullRequestCommit { url commit { oid messageHeadline committedDate } }
  ... on LabeledEvent { ${EVENT} label { name color } }
  ... on UnlabeledEvent { ${EVENT} label { name color } }
  ... on RenamedTitleEvent { ${EVENT} previousTitle currentTitle }
  ... on ReviewRequestedEvent { ${EVENT} ${REVIEWER} }
  ... on ReviewRequestRemovedEvent { ${EVENT} ${REVIEWER} }
  ... on ReviewDismissedEvent { ${EVENT} review { author { login } } }
  ... on AssignedEvent { ${EVENT} assignee { ... on Actor { login } } }
  ... on UnassignedEvent { ${EVENT} assignee { ... on Actor { login } } }
  ... on MilestonedEvent { ${EVENT} milestoneTitle }
  ... on DemilestonedEvent { ${EVENT} milestoneTitle }
  ... on MergedEvent { ${EVENT} mergeRefName }
  ... on HeadRefForcePushedEvent { ${EVENT} beforeCommit { oid } afterCommit { oid } }
  ... on BaseRefChangedEvent { ${EVENT} previousRefName currentRefName }
  ... on CrossReferencedEvent { ${EVENT} isCrossRepository source { ... on Issue { ${SOURCE} } ... on PullRequest { ${SOURCE} } } }
  ... on ReadyForReviewEvent { ${EVENT} } ... on ConvertToDraftEvent { ${EVENT} } ... on ClosedEvent { ${EVENT} } ... on ReopenedEvent { ${EVENT} }
  ... on HeadRefDeletedEvent { ${EVENT} } ... on HeadRefRestoredEvent { ${EVENT} }
  ... on AutoMergeEnabledEvent { ${EVENT} } ... on AutoMergeDisabledEvent { ${EVENT} } } } } } }`;

/** The rest of a review's comments, past its first page. */
export const REVIEW_COMMENTS_QUERY = `query($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequestReview {
  comments(first: ${PAGE}, after: $cursor) { ${REVIEW_COMMENT_IDS} } } } }`;

// A deleted account, as an actor or a requested reviewer, is null; GitHub shows it as "ghost".
const loginOf = z.object({ login: z.string() }).nullable().transform((actor) => actor?.login ?? "ghost");
const event = { id: z.string(), createdAt: z.string(), actor: loginOf };
const commentIdSchema = z.object({ databaseId: z.number() });

const ghStatusEventSchema = z.literal([
  "ReadyForReviewEvent",
  "ConvertToDraftEvent",
  "ClosedEvent",
  "ReopenedEvent",
  "HeadRefDeletedEvent",
  "HeadRefRestoredEvent",
  "AutoMergeEnabledEvent",
  "AutoMergeDisabledEvent",
]);

const STATUS_OF: Record<z.infer<typeof ghStatusEventSchema>, StatusChange> = {
  ReadyForReviewEvent: "ready-for-review",
  ConvertToDraftEvent: "draft",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  HeadRefDeletedEvent: "branch-deleted",
  HeadRefRestoredEvent: "branch-restored",
  AutoMergeEnabledEvent: "auto-merge-enabled",
  AutoMergeDisabledEvent: "auto-merge-disabled",
};

const ghReviewStateSchema = z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]);

// A PENDING review is the reader's own, not yet submitted: the parse leaves it out.
const VERDICT_OF: Record<z.infer<typeof ghReviewStateSchema>, ReviewVerdict | null> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: null,
};

const ghReviewSchema = ghCommentSchema.extend({
  __typename: z.literal("PullRequestReview"),
  id: z.string(),
  state: ghReviewStateSchema,
  submittedAt: z.string().nullable(),
  comments: connectionOf(commentIdSchema),
});
type GhReview = z.infer<typeof ghReviewSchema>;

const ghTimelineNodeSchema = z.discriminatedUnion("__typename", [
  ghCommentSchema.extend({ __typename: z.literal("IssueComment"), id: z.string() }),
  ghReviewSchema,
  z.object({
    __typename: z.literal("PullRequestCommit"),
    id: z.string(),
    url: z.string(),
    commit: z.object({ oid: z.string(), messageHeadline: z.string(), committedDate: z.string() }),
  }),
  z.object({ __typename: z.literal(["LabeledEvent", "UnlabeledEvent"]), ...event, label: ghLabelSchema }),
  z.object({ __typename: z.literal("RenamedTitleEvent"), ...event, previousTitle: z.string(), currentTitle: z.string() }),
  z.object({
    __typename: z.literal(["ReviewRequestedEvent", "ReviewRequestRemovedEvent"]),
    ...event,
    // A team has a name, and an account a login.
    requestedReviewer: z.union([z.object({ login: z.string() }), z.object({ name: z.string() })]).nullable(),
  }),
  z.object({ __typename: z.literal("ReviewDismissedEvent"), ...event, review: z.object({ author: loginOf }).nullable() }),
  z.object({ __typename: z.literal(["AssignedEvent", "UnassignedEvent"]), ...event, assignee: loginOf }),
  z.object({ __typename: z.literal(["MilestonedEvent", "DemilestonedEvent"]), ...event, milestoneTitle: z.string() }),
  z.object({ __typename: z.literal("MergedEvent"), ...event, mergeRefName: z.string() }),
  z.object({
    __typename: z.literal("HeadRefForcePushedEvent"),
    ...event,
    beforeCommit: z.object({ oid: z.string() }).nullable(),
    afterCommit: z.object({ oid: z.string() }).nullable(),
  }),
  z.object({ __typename: z.literal("BaseRefChangedEvent"), ...event, previousRefName: z.string(), currentRefName: z.string() }),
  z.object({
    __typename: z.literal("CrossReferencedEvent"),
    ...event,
    isCrossRepository: z.boolean(),
    source: z.object({ number: z.number(), title: z.string(), url: z.string(), repository: z.object({ nameWithOwner: z.string() }) }),
  }),
  z.object({ __typename: ghStatusEventSchema, ...event }),
]);
export type GhTimelineNode = z.infer<typeof ghTimelineNodeSchema>;

/** One page of TIMELINE_QUERY's response. */
export const parseTimelinePage = (json: unknown): Connection<GhTimelineNode> =>
  pullRequestOf({ timelineItems: connectionOf(ghTimelineNodeSchema) }).parse(json).data.repository.pullRequest.timelineItems;

/** One page of REVIEW_COMMENTS_QUERY's response. */
export const parseReviewCommentsPage = (json: unknown): Connection<z.infer<typeof commentIdSchema>> =>
  z.object({ data: z.object({ node: z.object({ comments: connectionOf(commentIdSchema) }) }) }).parse(json).data.node.comments;

export const isReview = (node: GhTimelineNode): node is GhReview => node.__typename === "PullRequestReview";

/**
 * The timeline as read, with each review's comment ids, by the review's node id (its first page
 * holds only some of a long review's). A review opens or replies in the threads that hold its
 * comments.
 */
export function toTimeline(nodes: GhTimelineNode[], reviewComments: ReadonlyMap<string, readonly number[]>, threads: readonly ReviewThread[]): TimelineItem[] {
  return nodes.flatMap((node): TimelineItem[] => {
    if (!isReview(node)) return [toItem(node)];
    const verdict = VERDICT_OF[node.state];
    if (verdict === null) return [];
    const ids = new Set(reviewComments.get(node.id));
    const threadIds = threads.filter((thread) => thread.comments.some((comment) => ids.has(comment.id))).map((thread) => thread.id);
    // A submitted review has its submission time; createdAt is when its first comment was drafted.
    const comment = toComment({ ...node, createdAt: node.submittedAt ?? node.createdAt });
    return [{ kind: "review", id: node.id, verdict, comment, threadIds }];
  });
}

function toItem(node: Exclude<GhTimelineNode, GhReview>): TimelineItem {
  switch (node.__typename) {
    case "IssueComment":
      return { kind: "comment", id: node.id, comment: toComment(node) };
    case "PullRequestCommit":
      return { kind: "commit", id: node.id, sha: node.commit.oid, headline: node.commit.messageHeadline, url: node.url, createdAt: node.commit.committedDate };
    case "LabeledEvent":
    case "UnlabeledEvent":
      return { kind: "labeled", ...eventOf(node), added: node.__typename === "LabeledEvent", label: node.label };
    case "RenamedTitleEvent":
      return { kind: "renamed", ...eventOf(node), from: node.previousTitle, to: node.currentTitle };
    case "ReviewRequestedEvent":
    case "ReviewRequestRemovedEvent":
      return { kind: "review-requested", ...eventOf(node), requested: node.__typename === "ReviewRequestedEvent", reviewer: reviewerOf(node.requestedReviewer) };
    case "ReviewDismissedEvent":
      return { kind: "review-dismissed", ...eventOf(node), reviewer: node.review?.author ?? "ghost" };
    case "AssignedEvent":
    case "UnassignedEvent":
      return { kind: "assigned", ...eventOf(node), assigned: node.__typename === "AssignedEvent", assignee: node.assignee };
    case "MilestonedEvent":
    case "DemilestonedEvent":
      return { kind: "milestoned", ...eventOf(node), added: node.__typename === "MilestonedEvent", title: node.milestoneTitle };
    case "MergedEvent":
      return { kind: "merged", ...eventOf(node), base: node.mergeRefName };
    case "HeadRefForcePushedEvent":
      return { kind: "force-pushed", ...eventOf(node), before: node.beforeCommit?.oid ?? null, after: node.afterCommit?.oid ?? null };
    case "BaseRefChangedEvent":
      return { kind: "base-changed", ...eventOf(node), from: node.previousRefName, to: node.currentRefName };
    case "CrossReferencedEvent": {
      const { source } = node;
      const ref = `${node.isCrossRepository ? source.repository.nameWithOwner : ""}#${source.number}`;
      return { kind: "referenced", ...eventOf(node), ref, title: source.title, url: source.url };
    }
    case "ReadyForReviewEvent":
    case "ConvertToDraftEvent":
    case "ClosedEvent":
    case "ReopenedEvent":
    case "HeadRefDeletedEvent":
    case "HeadRefRestoredEvent":
    case "AutoMergeEnabledEvent":
    case "AutoMergeDisabledEvent":
      return { kind: "status", ...eventOf(node), status: STATUS_OF[node.__typename] };
    default:
      return node satisfies never;
  }
}

const eventOf = (node: { id: string; createdAt: string; actor: string }) => ({ id: node.id, createdAt: node.createdAt, actor: node.actor });

const reviewerOf = (reviewer: { login: string } | { name: string } | null) => (reviewer === null ? "ghost" : "login" in reviewer ? reviewer.login : reviewer.name);
