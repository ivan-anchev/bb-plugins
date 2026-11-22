import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";
import { Avatar } from "../ui/avatar.tsx";

export function PrIdentity({ pr }: { pr: PrDetail }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Avatar login={pr.author} size={16} />
        {pr.author}
      </span>
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

function Branch({ children }: { children: ReactNode }) {
  return <code className="min-w-0 break-all font-mono text-xs transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none">{children}</code>;
}
