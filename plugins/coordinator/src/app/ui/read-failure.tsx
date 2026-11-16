import type { ReactNode } from "react";
import { Button } from "./button.tsx";

/** A failed read, said where its data would show, with Retry when the read can be made again. */
export function ReadFailure({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-2 px-3 text-sm text-destructive-text">
      <p>{children}</p>
      {onRetry !== undefined && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
