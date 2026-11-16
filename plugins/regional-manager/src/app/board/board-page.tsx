// The Board page in the panel: one coordinating thread's board, with the way back to the list and
// to its memory.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { useThreadTitle } from "../ui/use-thread-title.ts";
import { Board } from "./board.tsx";

type BoardPageProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; onBack(): void; onOpenMemory(): void };

export function BoardPage({ ref, coordinatorId, onBack, onOpenMemory }: BoardPageProps) {
  const title = useThreadTitle(coordinatorId);
  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col items-start gap-1">
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <Icon name="ArrowLeft" aria-hidden />
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={onOpenMemory}>
              <Icon name="FileText" aria-hidden />
              Memory
            </Button>
          </div>
          <h1 className="px-3 text-base font-medium text-pretty">Board{title !== null && <span className="text-muted-foreground"> · {title}</span>}</h1>
        </header>
        <Board coordinatorId={coordinatorId} />
      </div>
    </div>
  );
}
