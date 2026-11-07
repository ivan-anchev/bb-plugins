// The PR page header: number and title, author and `head → base`, and quiet "Review chat" (when a
// review thread exists) and "GitHub" actions, then the screen's own actions (`children`).
import type { ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";
import { ReviewChatButton } from "../review-chat/review-chat-button.tsx";
import { buttonClass } from "../ui/button.tsx";

type PrHeaderProps = { pr: PrDetail; hasReviewThread: boolean; children?: ReactNode };

export function PrHeader({ pr, hasReviewThread, children }: PrHeaderProps) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 px-7 pt-4 pb-3.5">
      <div className="min-w-0">
        <h1 className="text-base font-semibold leading-[22px] text-balance">
          <span className="font-medium tabular-nums text-muted-foreground">#{pr.number}</span> {pr.title}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{pr.author}</span>
          <span className="min-w-0 break-all">
            <code className="font-mono">{pr.headRefName}</code> → <code className="font-mono">{pr.baseRefName}</code>
          </span>
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {hasReviewThread && <ReviewChatButton variant="ghost" size="small" />}
        <UrlLink href={pr.url} className={buttonClass("ghost", "small")}>
          GitHub
        </UrlLink>
        {children}
      </div>
    </header>
  );
}

