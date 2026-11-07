// PR Reviews' settings, shown under Settings → PR Reviews.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const PR_REVIEWS_SETTINGS = {
  instructions: {
    type: "string",
    label: "Review instructions",
    description: "Sent as-is to every review thread, after PR Reviews' own rules. Put your review rules and any skill text here.",
    experimental_multiline: true,
    default: "",
  },
} as const;

export const defineReviewSettings = (bb: BbPluginApi) => bb.settings.define(PR_REVIEWS_SETTINGS);

export type ReviewSettings = ReturnType<typeof defineReviewSettings>;
