// The small glyphs in the activity's gutter, one per line: a commit, a force-push, a label, a
// review, an approval, the opening, the merge. bb's icons where it has one (the opening, the merge,
// a branch, a link); why our own SVG for the rest: bb's icon set has no commit, label, person or
// pencil. Each is 14px, drawn in its line's glyph colour, and decorative: the line's words say
// what happened.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReviewVerdict, StatusChange } from "../../comments/timeline-schema.ts";
import type { ActivityLine, LoneItem } from "./activity-fold.ts";

const BB_ICONS = { opened: "GitPullRequest", merged: "GitMerge", branch: "GitBranch", mention: "Link" } as const;

export type ActivityGlyphName = keyof typeof SHAPES | keyof typeof BB_ICONS;

const isBbIcon = (name: ActivityGlyphName): name is keyof typeof BB_ICONS => name in BB_ICONS;

export function ActivityGlyph({ name }: { name: ActivityGlyphName }) {
  if (isBbIcon(name)) return <Icon name={BB_ICONS[name]} aria-hidden className="size-3.5 shrink-0" />;
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[name]}
    </svg>
  );
}

export function glyphOf(line: ActivityLine): ActivityGlyphName {
  switch (line.kind) {
    case "opened":
    case "merged":
      return line.kind;
    case "commits":
      return "commit";
    case "force-pushes":
      return "force-push";
    case "labels":
    case "label-pair":
      return "label";
    case "review-requests":
      return line.items[0].requested ? "person" : "person-removed";
    case "mentions":
      return "mention";
    case "event":
      return eventGlyphOf(line.item);
    case "review":
      return REVIEW_GLYPHS[line.review.verdict];
    default:
      return line satisfies never;
  }
}

function eventGlyphOf(item: LoneItem): ActivityGlyphName {
  switch (item.kind) {
    case "renamed":
      return "pencil";
    case "review-dismissed":
      return "person-removed";
    case "assigned":
      return "person";
    case "milestoned":
      return "milestone";
    case "base-changed":
      return "branch";
    case "status":
      return STATUS_GLYPHS[item.status];
    default:
      return item satisfies never;
  }
}

const REVIEW_GLYPHS = { approved: "approved", "changes-requested": "changes-requested", commented: "review", dismissed: "review" } as const satisfies Record<ReviewVerdict, ActivityGlyphName>;

const STATUS_GLYPHS = {
  "ready-for-review": "ready",
  draft: "state",
  closed: "closed",
  reopened: "opened",
  "branch-deleted": "branch",
  "branch-restored": "branch",
  "auto-merge-enabled": "state",
  "auto-merge-disabled": "state",
} as const satisfies Record<StatusChange, ActivityGlyphName>;

const SHAPES = {
  commit: (
    <>
      <circle cx={8} cy={8} r={2.75} />
      <path d="M1.25 8h4M10.75 8h4" />
    </>
  ),
  label: (
    <>
      <path d="M1.75 2.75v4.1c0 .4.16.78.44 1.06l5.9 5.9a1.5 1.5 0 0 0 2.12 0l3.6-3.6a1.5 1.5 0 0 0 0-2.12l-5.9-5.9a1.5 1.5 0 0 0-1.06-.44h-4.1a1 1 0 0 0-1 1z" />
      <circle cx={5} cy={5} r={0.9} fill="currentColor" stroke="none" />
    </>
  ),
  review: <path d="M2.25 8a5.75 5.75 0 1 1 2.6 4.8l-2.85.95.95-2.7A5.7 5.7 0 0 1 2.25 8z" />,
  approved: (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <path d="M5.25 8.25 7.1 10.1 10.75 6.25" />
    </>
  ),
  "changes-requested": (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <path d="M8 4.75v4M8 11.1v.15" />
    </>
  ),
  person: (
    <>
      <circle cx={8} cy={5.25} r={2.75} />
      <path d="M2.75 14c.4-2.75 2.6-4.5 5.25-4.5s4.85 1.75 5.25 4.5" />
    </>
  ),
  "force-push": <path d="M8 14.5V6.5M4.75 9.5 8 6.25l3.25 3.25M4.75 5.25 8 2l3.25 3.25" />,
  "person-removed": <path d="M6.5 2.75a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM1.75 14c.35-2.5 2.3-4.25 4.75-4.25 1.1 0 2.1.35 2.9.95M11.25 9.75l3 3M14.25 9.75l-3 3" />,
  ready: (
    <>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx={8} cy={8} r={2} />
    </>
  ),
  closed: (
    <>
      <circle cx={4} cy={3.5} r={1.75} />
      <circle cx={4} cy={12.5} r={1.75} />
      <circle cx={12} cy={12.5} r={1.75} />
      <path d="M4 5.25v5.5M12 10.75V8.5M10.25 2.25l3.5 3.5M13.75 2.25l-3.5 3.5" />
    </>
  ),
  pencil: <path d="M10.6 2.4a1.8 1.8 0 0 1 2.55 2.55L5.3 12.8l-3.3.85.85-3.3z" />,
  state: (
    <>
      <circle cx={8} cy={8} r={6.25} />
      <circle cx={8} cy={8} r={1.25} fill="currentColor" stroke="none" />
    </>
  ),
  milestone: <path d="M3 14.25V2.25M3 2.75h8.5l-2 3 2 3H3" />,
} as const satisfies Record<string, ReactNode>;
