// The side panel's reviewers: avatar, name, and a glyph for where each stands, named for screen
// readers. A team shows a team glyph, and is always awaiting review: its members review as users.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Reviewer, ReviewerStatus } from "../../contract.ts";
import { Avatar } from "../ui/avatar.tsx";

const STATUS_LOOKS = {
  approved: { word: "Approved", icon: "CircleCheck", color: "text-success-foreground" },
  "changes-requested": { word: "Changes requested", icon: "FileDiff", color: "text-destructive-text" },
  commented: { word: "Commented", icon: "MessageSquare", color: "text-muted-foreground" },
  awaiting: { word: "Awaiting review", icon: "Clock", color: "text-muted-foreground" },
} as const satisfies Record<ReviewerStatus, { word: string; icon: string; color: string }>;

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
        <Icon name={status.icon} className={`size-3.5 ${status.color}`} aria-hidden />
        <span className="sr-only">{status.word}</span>
      </span>
    </li>
  );
}

function TeamGlyph() {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/8">
      <Icon name="Users" className="size-3" />
    </span>
  );
}

const nameOf = (reviewer: Reviewer): string => (reviewer.kind === "user" ? reviewer.login : reviewer.name);
const statusOf = (reviewer: Reviewer): ReviewerStatus => (reviewer.kind === "user" ? reviewer.status : "awaiting");
