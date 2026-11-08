// The PR header's identity row: `#number`, the author's GitHub avatar and login, and the branches
// GitHub's way round, `base ← head`.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";
import { Avatar } from "../ui/avatar.tsx";

export function PrIdentity({ pr }: { pr: PrDetail }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span className="font-medium tabular-nums">#{pr.number}</span>
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Avatar login={pr.author} size={16} />
        {pr.author}
      </span>
      {/* The arrow stays with the head branch, so a wrapped pair reads `base` over `← head`. */}
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        <Branch>{pr.baseRefName}</Branch>
        <span className="inline-flex min-w-0 items-center gap-1">
          <Icon name="ArrowLeft" className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
          <span className="sr-only">from</span>
          <Branch>{pr.headRefName}</Branch>
        </span>
      </span>
    </p>
  );
}

// Plain monospace text in the row's muted color. Hover lifts it to the foreground color, not a heavier
// weight, so the name keeps its width and nothing beside it moves. Decoration only: no link, no focus stop.
function Branch({ children }: { children: ReactNode }) {
  return <code className="min-w-0 break-all font-mono text-[11.5px] transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none">{children}</code>;
}
