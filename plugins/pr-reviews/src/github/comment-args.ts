// The comments the plugin posts as `gh api` arguments, field for field. Pure.
import { githubSideOf, type CommentRequest, type LineRef } from "../comments/comment-schema.ts";
import type { Repo } from "./repo.ts";

/** POST /repos/{repo}/pulls/{number}/comments: a line or a file comment, at the commit the reader viewed. */
export function commentApiArgs(repo: Repo, number: number, request: CommentRequest): string[] {
  const common = [
    ...["api", "--method", "POST", `repos/${repo}/pulls/${number}/comments`],
    ...text("body", request.body),
    ...text("commit_id", request.commit),
    ...text("path", request.path),
  ];
  switch (request.kind) {
    // why no subject_type: GitHub refuses `subject_type=line` beside `line` with a 422 ("No
    // subschema in oneOf matched"), recorded live; a comment with a line is a line comment.
    case "line":
      return [...common, ...lineFields(request.start, request.end)];
    case "file":
      return [...common, ...text("subject_type", "file")];
    default:
      return request satisfies never;
  }
}

/** POST /repos/{repo}/pulls/{number}/comments/{commentId}/replies: a reply in the thread `commentId` opens. */
export function replyApiArgs(repo: Repo, number: number, commentId: number, body: string): string[] {
  return ["api", "--method", "POST", `repos/${repo}/pulls/${number}/comments/${commentId}/replies`, ...text("body", body)];
}

/** POST /repos/{repo}/issues/{number}/comments: a comment on the PR's conversation, which GitHub keeps as the PR's issue. */
export function conversationCommentApiArgs(repo: Repo, number: number, body: string): string[] {
  return ["api", "--method", "POST", `repos/${repo}/issues/${number}/comments`, ...text("body", body)];
}

// why -f for text: -F reads a value starting with "@" as a file to upload, and turns "true",
// "false" and numbers into JSON. A comment can start with "@someone" and a path can be "123"; -f
// sends the text exactly. Each value is one argv entry, so newlines are safe.
const text = (key: string, value: string) => ["-f", `${key}=${value}`];

// why -F for line numbers: GitHub wants JSON integers, and -F sends "12" as 12.
const integer = (key: string, value: number) => ["-F", `${key}=${value}`];

// The last line goes in line/side; start_line/start_side only for a range.
function lineFields(start: LineRef | null, end: LineRef): string[] {
  const range = start === null ? [] : [...integer("start_line", start.line), ...text("start_side", githubSideOf(start.side))];
  return [...range, ...integer("line", end.line), ...text("side", githubSideOf(end.side))];
}
