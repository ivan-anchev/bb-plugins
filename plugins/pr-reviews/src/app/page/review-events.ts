// The ways the reader can submit their review, pending or new, in the review popover. Pure.
import type { ReviewEvent } from "../../comments/review-schema.ts";

export type ReviewEventOption = { event: ReviewEvent; label: string; description: string };

const EVENTS: readonly ReviewEventOption[] = [
  { event: "COMMENT", label: "Comment", description: "General feedback, without approving." },
  { event: "APPROVE", label: "Approve", description: "Approve merging these changes." },
  { event: "REQUEST_CHANGES", label: "Request changes", description: "Feedback that must be addressed before merging." },
];

/** `author`: the reader wrote the PR, and GitHub refuses their approval or request for changes on it. */
export function reviewEventsFor(author: boolean): readonly ReviewEventOption[] {
  return author ? EVENTS.filter((option) => option.event === "COMMENT") : EVENTS;
}

/**
 * GitHub refuses a new review, with no pending comments, as a comment with no body, and says
 * nothing of why; an approval or a request for changes needs none, nor does a pending review.
 */
export function bodyRequired(event: ReviewEvent, pending: boolean): boolean {
  return !pending && event === "COMMENT";
}
