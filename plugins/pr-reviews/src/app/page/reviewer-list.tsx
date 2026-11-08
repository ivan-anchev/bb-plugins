// The side panel's reviewers: avatar, name, and a glyph for where each stands, named for screen
// readers. A team shows a team glyph, and is always awaiting review: its members review as users.
import type { Reviewer, ReviewerStatus } from "../../contract.ts";
import { Avatar } from "../ui/avatar.tsx";
import { StatusGlyph, type StatusGlyphName } from "./status-glyph.tsx";

const STATUS_LOOKS = {
  approved: { word: "Approved", glyph: "passed" },
  "changes-requested": { word: "Changes requested", glyph: "failed" },
  commented: { word: "Commented", glyph: "commented" },
  awaiting: { word: "Awaiting review", glyph: "awaiting" },
} as const satisfies Record<ReviewerStatus, { word: string; glyph: StatusGlyphName }>;

export function ReviewerList({ reviewers }: { reviewers: Reviewer[] }) {
  return (
    <ul>
      {reviewers.map((reviewer) => (
        <ReviewerRow key={`${reviewer.kind}:${nameOf(reviewer)}`} reviewer={reviewer} />
      ))}
    </ul>
  );
}

function ReviewerRow({ reviewer }: { reviewer: Reviewer }) {
  const status = STATUS_LOOKS[statusOf(reviewer)];
  return (
    <li className="flex min-h-[26px] items-center gap-2 text-[12.5px]">
      {reviewer.kind === "user" ? <Avatar login={reviewer.login} size={20} /> : <TeamGlyph />}
      <span className="min-w-0 truncate">{nameOf(reviewer)}</span>
      <span className="ml-auto inline-flex shrink-0">
        <StatusGlyph name={status.glyph} />
        <span className="sr-only">{status.word}</span>
      </span>
    </li>
  );
}

// why our own SVG: bb's icon set has one person (`UserRound`) and no group. Two people drawn the way
// bb draws `UserRound`: 24-unit grid, 1.5 stroke, round ends; the one behind shows only its left half.
function TeamGlyph() {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/8">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="size-3">
        <circle cx={14.5} cy={7.5} r={3.5} />
        <path d="M21 20c-.35-3.4-3.1-6-6.5-6S8.35 16.6 8 20" />
        <path d="M8.5 4.5a3 3 0 0 0 0 6" />
        <path d="M3 19.5c.25-2.6 1.9-4.6 4.25-5.25" />
      </svg>
    </span>
  );
}

const nameOf = (reviewer: Reviewer): string => (reviewer.kind === "user" ? reviewer.login : reviewer.name);
const statusOf = (reviewer: Reviewer): ReviewerStatus => (reviewer.kind === "user" ? reviewer.status : "awaiting");
