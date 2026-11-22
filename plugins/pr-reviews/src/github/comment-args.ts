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

const text = (key: string, value: string) => ["-f", `${key}=${value}`];

const integer = (key: string, value: number) => ["-F", `${key}=${value}`];

function lineFields(start: LineRef | null, end: LineRef): string[] {
  const range = start === null ? [] : [...integer("start_line", start.line), ...text("start_side", githubSideOf(start.side))];
  return [...range, ...integer("line", end.line), ...text("side", githubSideOf(end.side))];
}
