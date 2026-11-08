// A PR's reviewers as gh reports them: `reviewRequests` (users and teams asked for a review that is
// still outstanding) and `latestReviews` (each reviewer's latest review). A re-request outranks an
// older review: that reviewer is awaiting review again. Review states this plugin does not show
// (dismissed, a pending draft, or one GitHub adds later) and request kinds it does not know drop
// out, so they never fail the page read.
import { z } from "zod";
import type { Reviewer, ReviewerStatus } from "../contract.ts";

// A Bot (such as Copilot) is requested by login, like a user.
const reviewRequestSchema = z.union([
  z.object({ __typename: z.enum(["User", "Bot"]), login: z.string() }).transform(({ login }): Reviewer => ({ kind: "user", login, status: "awaiting" })),
  z.object({ __typename: z.literal("Team"), name: z.string() }).transform(({ name }): Reviewer => ({ kind: "team", name })),
  z.object({ __typename: z.string() }).transform(() => null),
]);

const REVIEW_STATUS = { APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", COMMENTED: "commented" } as const satisfies Record<string, ReviewerStatus>;

const latestReviewSchema = z.object({
  author: z.object({ login: z.string() }),
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]).nullable().catch(null),
});

export const reviewRequestsSchema = z.array(reviewRequestSchema).transform((requests) => requests.filter((request) => request !== null));
export const latestReviewsSchema = z.array(latestReviewSchema);

/** Requested reviewers first, in GitHub's order, then everyone else whose latest review shows. */
export function toReviewers(requested: Reviewer[], reviews: z.infer<typeof latestReviewsSchema>): Reviewer[] {
  const requestedLogins = new Set(requested.flatMap((reviewer) => (reviewer.kind === "user" ? [reviewer.login] : [])));
  const reviewed = reviews.flatMap(({ author: { login }, state }): Reviewer[] =>
    state === null || requestedLogins.has(login) ? [] : [{ kind: "user", login, status: REVIEW_STATUS[state] }],
  );
  return [...requested, ...reviewed];
}
