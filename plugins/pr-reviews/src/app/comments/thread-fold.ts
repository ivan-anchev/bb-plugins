// Whether a review thread shows as its one folded row. Pure.
import type { ReviewThread } from "../../comments/thread-schema.ts";

/**
 * A resolved thread folds until the reader opens it (`expanded`); an open thread never folds.
 * Resolution comes from the thread as last read, so one GitHub reopens shows open.
 */
export const isFolded = (thread: ReviewThread, expanded: boolean): boolean => thread.resolvedBy !== null && !expanded;
