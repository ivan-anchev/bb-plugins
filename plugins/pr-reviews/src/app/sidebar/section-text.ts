import type { SectionKey } from "../../contract.ts";

export const SECTION_TEXT = {
  authored: { title: "Authored by me", chip: "Mine", empty: "No open pull requests of yours.", tag: "Yours" },
  review: { title: "Needs my review", chip: "Review", empty: "No reviews requested from you.", tag: "Review" },
  merged: { title: "Recently merged", chip: "Merged", empty: "Nothing merged in the last 7 days.", tag: null },
} as const satisfies Record<SectionKey, { title: string; chip: string; empty: string; tag: string | null }>;
