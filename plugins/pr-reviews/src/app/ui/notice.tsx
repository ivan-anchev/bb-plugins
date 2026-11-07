import type { ReactNode } from "react";

export function Notice({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "error" }) {
  return tone === "error" ? (
    <p role="alert" className="px-3 py-4 text-xs text-destructive-text">
      {children}
    </p>
  ) : (
    <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
