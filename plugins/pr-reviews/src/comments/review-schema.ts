// The reader's own review of a PR on GitHub: whether they wrote the PR, the pending review they are
// writing, and how they submit it. Pure zod, shared by the server and the app.
import { z } from "zod";

/**
 * `author`: the reader wrote the PR, so they comment rather than review. `pendingReviewId`: the
 * node id of the reader's pending review, which GitHub keeps unpublished until they submit it;
 * null for none. GitHub allows one per reader per PR, and shows it to no one else.
 */
export const viewerReviewSchema = z.object({ author: z.boolean(), pendingReviewId: z.string().nullable() });
export type ViewerReview = z.infer<typeof viewerReviewSchema>;

/** How a pending review is submitted, in GitHub's words. */
export const reviewEventSchema = z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
