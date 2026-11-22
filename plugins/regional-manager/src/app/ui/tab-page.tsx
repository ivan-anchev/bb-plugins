import type { ReactNode } from "react";

export function TabPage({ children }: { children: ReactNode }) {
  return (
    <div tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">{children}</div>
    </div>
  );
}
