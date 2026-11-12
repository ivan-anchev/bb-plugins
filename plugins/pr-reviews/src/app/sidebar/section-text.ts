// What the sidebar calls each section: its heading, the line it shows when empty, and the short
// tag a stack-mate listed in it carries in another section's stack.
import type { SectionKey } from "../../contract.ts";

export const SECTION_TEXT = {
  authored: { title: "Authored by me", empty: "No open pull requests of yours.", tag: "Yours" },
  review: { title: "Needs my review", empty: "No reviews requested from you.", tag: "Review" },
  // A merged stack-mate's status icon already says where it is.
  merged: { title: "Recently merged", empty: "Nothing merged in the last 7 days.", tag: null },
} as const satisfies Record<SectionKey, { title: string; empty: string; tag: string | null }>;
