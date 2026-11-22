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
    <li className="flex min-h-7 items-center gap-2 text-xs">
      <StatusGlyph name={status.glyph} />
      {reviewer.kind === "user" ? <Avatar login={reviewer.login} size={20} /> : <TeamGlyph />}
      <span className="min-w-0 truncate">{nameOf(reviewer)}</span>
      <span className="sr-only">, {status.word}</span>
    </li>
  );
}

function TeamGlyph() {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
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
