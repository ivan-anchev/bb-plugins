// The PR page header: number and title, author and `head → base`, and a quiet GitHub link.
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";

export function PrHeader({ pr }: { pr: PrDetail }) {
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
      <UrlLink
        href={pr.url}
        className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        GitHub
      </UrlLink>
    </header>
  );
}
