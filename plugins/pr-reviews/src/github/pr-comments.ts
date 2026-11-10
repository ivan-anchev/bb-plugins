// A PR's comments as GitHub's GraphQL API serves them: the queries, a page reader that follows a
// connection to its end, and the parse into the canonical thread and comment types. gh.ts runs the
// queries. Pure.
import { z } from "zod";
import type { LineRef } from "../comments/comment-schema.ts";
import type { GitHubComment, LineAnchor, ReviewThread } from "../comments/thread-schema.ts";
import { numberedLines, type NumberedLine } from "../diff/diff-schema.ts";
import type { Repo } from "./repo.ts";

// GitHub's largest page.
const PAGE = 100;

const COMMENT_FIELDS = "databaseId url body createdAt author { __typename login }";
const REVIEW_COMMENTS = `pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} commit { oid } originalCommit { oid } diffHunk }`;
const PR = "query($owner: String!, $name: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {";

export const THREADS_QUERY = `${PR} reviewThreads(first: ${PAGE}, after: $cursor) { pageInfo { hasNextPage endCursor } nodes {
  id isResolved resolvedBy { login } isOutdated path subjectType line startLine diffSide startDiffSide originalLine originalStartLine
  comments(first: ${PAGE}) { ${REVIEW_COMMENTS} } } } } } }`;

/** The rest of a thread with more comments than its first page holds. */
export const THREAD_COMMENTS_QUERY = `query($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequestReviewThread {
  comments(first: ${PAGE}, after: $cursor) { ${REVIEW_COMMENTS} } } } }`;

export const CONVERSATION_QUERY = `${PR} comments(first: ${PAGE}, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } } } }`;

/** `gh api graphql` arguments: text by -f, numbers by -F as JSON integers. A null cursor is left out, so the query starts at the first page. */
export function graphqlArgs(query: string, variables: Record<string, string | number | null>): string[] {
  const fields = Object.entries(variables).flatMap(([key, value]) => {
    if (value === null) return [];
    return typeof value === "number" ? ["-F", `${key}=${value}`] : ["-f", `${key}=${value}`];
  });
  return ["api", "graphql", "-f", `query=${query}`, ...fields];
}

/** The PR variables of THREADS_QUERY and CONVERSATION_QUERY. */
export function prVariables(repo: Repo, number: number) {
  const [owner, name] = repo.split("/");
  return { owner, name, number };
}

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const connectionOf = <Node extends z.ZodType>(node: Node) => z.object({ pageInfo: pageInfoSchema, nodes: z.array(node) });
type Connection<Node> = { pageInfo: z.infer<typeof pageInfoSchema>; nodes: Node[] };

/** Every node of a connection, page after page from `first`, the page already read (or null to read it too). */
export async function allPages<Node>(first: Connection<Node> | null, readPage: (cursor: string | null) => Promise<Connection<Node>>): Promise<Node[]> {
  let page = first ?? (await readPage(null));
  const nodes = [...page.nodes];
  while (page.pageInfo.hasNextPage) {
    page = await readPage(page.pageInfo.endCursor);
    nodes.push(...page.nodes);
  }
  return nodes;
}

// A deleted account's comments have no author; GitHub shows them as "ghost". An app's author is a Bot.
const ghCommentSchema = z.object({
  databaseId: z.number(),
  url: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: z.object({ __typename: z.string(), login: z.string() }).nullable(),
});

const ghReviewCommentSchema = ghCommentSchema.extend({
  commit: z.object({ oid: z.string() }).nullable(),
  originalCommit: z.object({ oid: z.string() }).nullable(),
  diffHunk: z.string(),
});
type GhReviewComment = z.infer<typeof ghReviewCommentSchema>;

const ghSideSchema = z.enum(["LEFT", "RIGHT"]);

const ghThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  resolvedBy: z.object({ login: z.string() }).nullable(),
  isOutdated: z.boolean(),
  path: z.string(),
  subjectType: z.enum(["LINE", "FILE"]),
  line: z.number().nullable(),
  startLine: z.number().nullable(),
  diffSide: ghSideSchema,
  startDiffSide: ghSideSchema.nullable(),
  originalLine: z.number().nullable(),
  originalStartLine: z.number().nullable(),
  comments: connectionOf(ghReviewCommentSchema),
});
type GhThread = z.infer<typeof ghThreadSchema>;

const pullRequestOf = <Shape extends z.ZodRawShape>(shape: Shape) => z.object({ data: z.object({ repository: z.object({ pullRequest: z.object(shape) }) }) });

/** One page of THREADS_QUERY's response. */
export const parseThreadsPage = (json: unknown): Connection<GhThread> => pullRequestOf({ reviewThreads: connectionOf(ghThreadSchema) }).parse(json).data.repository.pullRequest.reviewThreads;

/** One page of THREAD_COMMENTS_QUERY's response. */
export const parseThreadCommentsPage = (json: unknown): Connection<GhReviewComment> =>
  z.object({ data: z.object({ node: z.object({ comments: connectionOf(ghReviewCommentSchema) }) }) }).parse(json).data.node.comments;

/** One page of CONVERSATION_QUERY's response, as canonical comments. */
export function parseConversationPage(json: unknown): Connection<GitHubComment> {
  const { pageInfo, nodes } = pullRequestOf({ comments: connectionOf(ghCommentSchema) }).parse(json).data.repository.pullRequest.comments;
  return { pageInfo, nodes: nodes.map(toComment) };
}

/** A thread as read, with every one of its comments (its first page holds only some of a long thread's). */
export function toThread(thread: GhThread, comments: GhReviewComment[]): ReviewThread {
  const [first] = comments;
  return {
    id: thread.id,
    path: thread.path,
    // A thread resolved by a since-deleted account has no resolver; GitHub shows "ghost".
    resolvedBy: thread.isResolved ? (thread.resolvedBy?.login ?? "ghost") : null,
    outdated: thread.isOutdated,
    subject: thread.subjectType === "FILE" ? { kind: "file" } : { kind: "lines", anchors: anchorsOf(thread, first), excerpt: excerptOf(thread, first.diffHunk) },
    comments: comments.map(toComment),
  };
}

const toComment = (comment: z.infer<typeof ghCommentSchema>): GitHubComment => ({
  id: comment.databaseId,
  url: comment.url,
  author: comment.author === null ? { login: "ghost", bot: false } : { login: comment.author.login, bot: comment.author.__typename === "Bot" },
  body: comment.body,
  createdAt: comment.createdAt,
});

const sideOf = (side: z.infer<typeof ghSideSchema>): LineRef["side"] => (side === "LEFT" ? "old" : "new");

// The thread's lines at the head (GitHub's line fields, null once outdated, on its first comment's
// `commit`) and where it was written (the original fields, on `originalCommit`). GitHub reports a
// one-line thread's start as its line, or as none; either way it has no start.
function anchorsOf(thread: GhThread, first: GhReviewComment): LineAnchor[] {
  const anchor = (commit: { oid: string } | null, start: number | null, end: number | null): LineAnchor[] => {
    if (commit === null || end === null) return [];
    const endRef = { side: sideOf(thread.diffSide), line: end };
    const startRef = start === null ? null : { side: sideOf(thread.startDiffSide ?? thread.diffSide), line: start };
    const oneLine = startRef === null || (startRef.side === endRef.side && startRef.line === endRef.line);
    return [{ commit: commit.oid, start: oneLine ? null : startRef, end: endRef }];
  };
  const current = thread.isOutdated ? [] : anchor(first.commit, thread.startLine, thread.line);
  const original = anchor(first.originalCommit, thread.originalStartLine, thread.originalLine);
  // The same commit has the same lines: the thread was written at the head.
  return current.length > 0 && original[0]?.commit === current[0].commit ? current : [...current, ...original];
}

// GitHub keeps each review comment's hunk up to the line it was written on, its last line. The
// thread's lines are the hunk's last ones: from its start line, or, for one line, the last few
// (as GitHub shows an outdated comment).
const EXCERPT_CONTEXT = 4;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function excerptOf(thread: GhThread, diffHunk: string): NumberedLine[] {
  const [header, ...lines] = diffHunk.split("\n");
  const numbers = HUNK_HEADER.exec(header);
  if (numbers === null) return [];
  const [, oldStart, oldLines = "1", newStart, newLines = "1"] = numbers;
  const hunk = { oldStart: Number(oldStart), oldLines: Number(oldLines), newStart: Number(newStart), newLines: Number(newLines), lines };
  const rows = numberedLines(hunk).filter((row) => row.old !== null || row.new !== null);
  const startSide = sideOf(thread.startDiffSide ?? thread.diffSide);
  const start = thread.originalStartLine === null ? -1 : rows.findIndex((row) => row[startSide] === thread.originalStartLine);
  return rows.slice(start === -1 ? Math.max(0, rows.length - EXCERPT_CONTEXT) : start);
}
