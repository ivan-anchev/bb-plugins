// The PR page header, a masthead: the PR tile, the title, and the identity row (`#number`, author,
// `base ← head`) on the left; icon actions (Review chat when a review thread exists, GitHub, then
// the screen's own `children`) over the stats strip on the right.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";
import { ReviewChatIconButton } from "../review-chat/review-chat-button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { PrIdentity } from "./pr-identity.tsx";
import { PrStats } from "./pr-stats.tsx";

type PrHeaderProps = { pr: PrDetail; hasReviewThread: boolean; children?: ReactNode };

export function PrHeader({ pr, hasReviewThread, children }: PrHeaderProps) {
  return (
    <header className="@container shrink-0 px-7 pt-4 pb-3.5">
      <div className={MASTHEAD}>
        <PrTile />
        <h1 className="text-[17px] leading-6 font-semibold text-pretty [grid-area:title]">{pr.title}</h1>
        {/* -my-0.5 centers the 28px buttons on the title's 24px first line; -mr-1.5 lines the last
            glyph, not its hit area, up with the stats' right edge. */}
        <div className="-my-0.5 -mr-1.5 flex gap-1 justify-self-end [grid-area:actions]">
          {hasReviewThread && <ReviewChatIconButton />}
          <IconLink icon="Github" label="Open on GitHub" href={pr.url} />
          {children}
        </div>
        <div className="[grid-area:identity]">
          <PrIdentity pr={pr} />
        </div>
        <div className="justify-self-end [grid-area:stats] @max-[860px]:mt-0.5 @max-[860px]:justify-self-start">
          <PrStats pr={pr} />
        </div>
      </div>
    </header>
  );
}

// Wide: the stats sit under the actions. Below 860px they drop under the identity row, and below
// 560px the tile hides so the title gets the width.
const MASTHEAD =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 [grid-template-areas:'tile_title_actions'_'tile_identity_stats'] @max-[860px]:[grid-template-areas:'tile_title_actions'_'tile_identity_identity'_'._stats_stats'] @max-[560px]:grid-cols-[minmax(0,1fr)_auto] @max-[560px]:[grid-template-areas:'title_actions'_'identity_identity'_'stats_stats']";

function PrTile() {
  return (
    <span aria-hidden className="mt-[3px] grid size-8 place-items-center rounded-lg bg-secondary text-foreground ring-1 ring-border-seam ring-inset [grid-area:tile] @max-[560px]:hidden">
      <Icon name="GitPullRequest" className="size-[18px]" />
    </span>
  );
}
