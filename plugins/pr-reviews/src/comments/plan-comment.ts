// What a comment on some lines becomes on GitHub, built exactly: a line comment when GitHub can
// anchor to the lines, else a file comment that quotes them. And a reply in a review thread, and a
// comment on the PR's conversation. The
// comment box checks the plan as the reader writes, and Comment or Reply sends its request as is.
// Pure.
import { commitsSince, shortSha, type PrDetail } from "../contract.ts";
import type { Finding } from "../guide/guide-schema.ts";
import { GITHUB_BODY_LIMIT, type CodeQuote, type CommentRequest } from "./comment-schema.ts";
import { inOneHunk, linesLabel, quoteOf, type LineSpan } from "./line-span.ts";
import type { ReviewThread } from "./thread-schema.ts";

/** `why`: for a file comment, why the lines could not carry a line comment ("some of these lines …"). Display only. */
export type CommentPlan = { request: CommentRequest; why: string | null };

/** Why nothing can be posted on these lines: there is no request to post. */
export type BlockedComment = { blocked: string };

/**
 * `commitInPr`: whether `span.commit` is still one of the PR's commits. A commit force-pushed
 * away blocks the comment: the lines are no longer the PR's code, and a PR (issue) comment is
 * never posted instead. (GitHub itself may still take it, moved onto the new head.) `text` is
 * what the reader wrote; it is posted trimmed.
 */
export function planComment(span: LineSpan, commitInPr: boolean, text: string): CommentPlan | BlockedComment {
  if (!commitInPr) {
    return { blocked: `Commit ${shortSha(span.commit)} is no longer in the PR (force-pushed). To comment on the current code, Refresh and use the Changes tab, or update the guide.` };
  }
  const quote = quoteOf(span);
  const body = text.trim();
  if (!inOneHunk(span)) {
    return { request: { kind: "file", commit: span.commit, path: span.path, body: quoted(quote, body) }, why: whyNotOneHunk(span) };
  }
  // why no start for one row: GitHub takes a single line as `line`/`side` alone.
  const start = span.rows.length === 1 ? null : quote.start;
  return { request: { kind: "line", commit: span.commit, path: span.path, start, end: quote.end, body }, why: null };
}

/**
 * What Comment would post on these lines with this text, checked against the PR as last read: the
 * request, and a note on where it goes only when that isn't obvious (an older commit than the
 * PR's latest, or a file comment); or why it can't be posted.
 */
export type CommentCheck = { request: CommentRequest; note: string | null } | BlockedComment;

export function checkComment(span: LineSpan, pr: PrDetail, text: string): CommentCheck {
  const since = commitsSince(pr, span.commit);
  const planned = planComment(span, since !== null, text);
  if ("blocked" in planned) return planned;
  const { request, why } = planned;
  if (request.body.length > GITHUB_BODY_LIMIT) return { blocked: `${tooLong(request.body)} Shorten it, or select fewer lines.` };
  const notes = [since === 0 ? null : `Comments on commit ${shortSha(span.commit)}, not the latest.`, why === null ? null : `Posts as a file comment: ${why}.`];
  const note = notes.filter((line) => line !== null).join(" ");
  return { request, note: note === "" ? null : note };
}

/** A reply exactly as GitHub is asked to post it: in the thread that its first comment, `commentId`, opens. */
export type ReplyRequest = { commentId: number; body: string };

/** What Reply would post in the thread with this text, trimmed; or why it can't be posted. */
export function checkReply(thread: ReviewThread, text: string): { request: ReplyRequest } | BlockedComment {
  const checked = bodyOf(text);
  return "blocked" in checked ? checked : { request: { commentId: thread.comments[0].id, body: checked.body } };
}

/** A comment on the PR's conversation exactly as GitHub is asked to post it. */
export type ConversationRequest = { body: string };

/** What Comment would post on the PR's conversation with this text, trimmed; or why it can't be posted. */
export function checkConversationComment(text: string): { request: ConversationRequest } | BlockedComment {
  const checked = bodyOf(text);
  return "blocked" in checked ? checked : { request: checked };
}

function bodyOf(text: string): ConversationRequest | BlockedComment {
  const body = text.trim();
  return body.length > GITHUB_BODY_LIMIT ? { blocked: `${tooLong(body)} Shorten it.` } : { body };
}

const tooLong = (body: string) => `This comment is ${body.length.toLocaleString("en")} characters, and GitHub takes at most ${GITHUB_BODY_LIMIT.toLocaleString("en")}.`;

/** A finding as a comment: its title in bold, then its body. The guide's priority stays out. */
export const findingCommentText = (finding: Finding): string => `**${finding.title}**\n\n${finding.body}`;

// GitHub anchors a line comment only inside one hunk.
function whyNotOneHunk({ rows }: LineSpan): string {
  return rows.some((row) => row.hunk === null) ? "some of these lines are outside the PR's changes" : "these lines span more than one hunk";
}

// `path`, lines …, at abc1234:  then the rows in a diff fence, then the reader's words.
function quoted(quote: CodeQuote, body: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(quote.lines.join("\n")) + 1));
  return [`${inlineCode(quote.path)}, ${linesLabel(quote.start, quote.end)}, at ${shortSha(quote.commit)}:`, `${fence}diff`, ...quote.lines, fence, "", body].join("\n");
}

// CommonMark inline code: a delimiter longer than any backtick run inside, and padding spaces when
// the text holds backticks or starts or ends with a space (one padding space each side is dropped).
function inlineCode(text: string): string {
  const delimiter = "`".repeat(longestBacktickRun(text) + 1);
  const pad = /`|^ | $/.test(text) ? " " : "";
  return `${delimiter}${pad}${text}${pad}${delimiter}`;
}

const longestBacktickRun = (text: string) => Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
