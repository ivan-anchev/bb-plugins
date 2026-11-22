import { useRef, type ReactNode } from "react";
import { STATUS_LABELS, type IssueStatus } from "../../../model/issue/status.ts";
import { useRing } from "./motion/ring.ts";

const SIZE = 14;

export function StatusGlyph({ status, still = false }: { status: IssueStatus; still?: boolean }) {
  return (
    <span className="rmi-state" data-state={status} role="img" aria-label={STATUS_LABELS[status]}>
      {glyph(status, still)}
    </span>
  );
}

/** Needs you's mark, Activity Sidebar's "failed" glyph: it waits on the user whatever its status. */
export function NeedsYouGlyph() {
  return (
    <span className="rmi-state" data-state="needs-you" aria-hidden>
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </Icon>
    </span>
  );
}

function glyph(status: IssueStatus, still: boolean): ReactNode {
  switch (status) {
    case "backlog":
      return (
        <Icon>
          <circle cx="12" cy="12" r="9" strokeWidth={2.25} strokeDasharray="0.01 4.71" />
        </Icon>
      );
    case "todo":
      return (
        <Icon>
          <circle cx="12" cy="12" r="9" strokeWidth={1.75} />
        </Icon>
      );
    case "in-progress":
    case "verifying":
      return <Ring still={still} />;
    case "in-review":
    case "done":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </Icon>
      );
    case "canceled":
      return (
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6M9 9l6 6" />
        </Icon>
      );
    default:
      return status satisfies never;
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Ring({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRing(ref, SIZE, still);
  return <canvas ref={ref} className="rmi-ring" style={{ width: SIZE, height: SIZE }} aria-hidden />;
}
