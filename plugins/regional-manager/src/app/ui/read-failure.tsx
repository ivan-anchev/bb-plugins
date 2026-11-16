import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { handFocusToPage } from "./focus-hand-off.ts";

/**
 * A failed read, said where its data would show, with Retry when the read can be made again. A Retry
 * that succeeds removes it, so focus in it moves to the page.
 */
export function ReadFailure({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div ref={handFocusToPage} role="alert" className="flex flex-wrap items-center gap-x-2 px-3 text-sm text-destructive-text">
      <p>{children}</p>
      {onRetry !== undefined && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
