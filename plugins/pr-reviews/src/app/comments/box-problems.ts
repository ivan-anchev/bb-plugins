// What the comment box's footer says stops it: the draft can't be posted as it is, or the last
// request failed.

export type Action = "ask" | "comment";

/** A request that failed, with the draft it sent: the failure is about that text only. */
export type Failure = { action: Action; message: string; draft: string };

/**
 * `blocked`: why Comment can't post the draft now (plan-comment.ts). A failure counts only while
 * the draft is the text that failed. A block is current and replaces a failed comment, whose
 * cause it supersedes; a failed question is not about commenting, so it stays beside one.
 */
export function problemsOf(blocked: string | null, failure: Failure | null, draft: string): string[] {
  const failed = failure !== null && failure.draft === draft ? failure : null;
  if (failed === null) return blocked === null ? [] : [blocked];
  if (blocked === null) return [failed.message];
  return failed.action === "comment" ? [blocked] : [blocked, failed.message];
}
