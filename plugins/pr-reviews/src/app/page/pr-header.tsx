// The PR header, a masthead: the PR's state tile, the title, and the identity row (`#number`,
// author, `base ← head`) on the left; icon actions (Review chat when a review thread exists, then
// GitHub) on the right. The PR's line counts are on the Changes tab.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail, PrState } from "../../contract.ts";
import { ReviewChatIconButton } from "../review-chat/review-chat-button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { PrIdentity } from "./pr-identity.tsx";

type PrHeaderProps = { pr: PrDetail; hasReviewThread: boolean };

export function PrHeader({ pr, hasReviewThread }: PrHeaderProps) {
  return (
    <header className="shrink-0 px-7 pt-4 pb-3.5">
      <div className={MASTHEAD}>
        <PrStateTile state={pr.state} />
        <h1 className="text-[17px] leading-6 font-semibold text-pretty break-words [grid-area:title]">{pr.title}</h1>
        {/* -my-0.5 centers the 28px buttons on the title's 24px first line; -mr-1.5 lines the last
            glyph, not its hit area, up with the header's right edge. */}
        <div className="-my-0.5 -mr-1.5 flex gap-1 justify-self-end [grid-area:actions]">
          {hasReviewThread && <ReviewChatIconButton />}
          <IconLink icon="Github" label="Open on GitHub" href={pr.url} />
        </div>
        <div className="[grid-area:identity]">
          <PrIdentity pr={pr} />
        </div>
      </div>
    </header>
  );
}

// One layout at every width: the identity row runs under the actions, so a narrow page wraps the
// branches rather than leaving a column empty.
const MASTHEAD = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 [grid-template-areas:'tile_title_actions'_'tile_identity_identity']";

// why a purple of our own: bb has no purple token. GitHub's merged purple mixed a quarter toward
// the foreground reads 5.04:1 on its tinted tile in the dark theme and 4.79:1 in light, over the
// 3:1 a graphic needs.
const MERGED = "text-[color-mix(in_oklab,#8957e5_75%,var(--foreground))]";

const STATE_TILES = {
  OPEN: { label: "Open", icon: "GitPullRequest", color: "text-success-foreground" },
  DRAFT: { label: "Draft", icon: "GitPullRequestDraft", color: "text-muted-foreground" },
  MERGED: { label: "Merged", icon: "GitMerge", color: MERGED },
  CLOSED: { label: "Closed", icon: "GitPullRequestClosed", color: "text-destructive-text" },
} as const satisfies Record<PrState, { label: string; icon: string; color: string }>;

// The tile names the state to a screen reader and, as a tooltip, on hover. It stays at every
// width, since it is the header's only mark of the state. Its wash is the icon's own color at 15%
// over the page; the icon reads 3.98:1 or more on it (open, light theme, is the lowest).
function PrStateTile({ state }: { state: PrState }) {
  const { label, icon, color } = STATE_TILES[state];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`mt-[3px] grid size-8 place-items-center rounded-lg bg-[color-mix(in_oklab,currentColor_15%,transparent)] [grid-area:tile] ${color}`}
    >
      <Icon name={icon} aria-hidden className="size-[18px]" />
    </span>
  );
}
