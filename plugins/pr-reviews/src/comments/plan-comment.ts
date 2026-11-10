// What a comment on some lines becomes on GitHub, built exactly: a line comment when GitHub can
// anchor to the lines, else a file comment that quotes them. The preview shows the plan and Post
// sends its request as is. Pure.
import { shortSha } from "../contract.ts";
import type { Finding } from "../guide/guide-schema.ts";
import type { CodeQuote, CommentRequest } from "./comment-schema.ts";
import { inOneHunk, linesLabel, quoteOf, type LineSpan } from "./line-span.ts";

/** `why`: for a file comment, why the lines could not carry a line comment. Display only. */
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

/** A finding as a comment: its title in bold, then its body. The guide's priority stays out. */
export const findingCommentText = (finding: Finding): string => `**${finding.title}**\n\n${finding.body}`;

function whyNotOneHunk({ rows }: LineSpan): string {
  const reason = rows.some((row) => row.hunk === null)
    ? "Some of these lines are unchanged lines outside the PR's changes"
    : "These lines run across more than one hunk of the diff";
  return `${reason}, and GitHub anchors a line comment only inside one hunk. It posts as a comment on the file, quoting them.`;
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
