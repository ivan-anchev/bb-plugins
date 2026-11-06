// One delegate, collapsed: avatar with status dot, title over the detail line,
// and its own elapsed time. Every word comes from roster.ts.
import type { Delegate } from "../delegate.ts";
import { detailLine, elapsed, isRunning } from "../roster.ts";
import { formatDuration, useNow } from "../clock.ts";
import { Avatar } from "./Avatar.tsx";
import { RollingText } from "./Motion.tsx";

export function DelegateRow({ providerId, delegate: d }: { providerId: string; delegate: Delegate }) {
  const now = useNow(isRunning(d));
  return (
    <li className="sr-row" data-st={d.state.status}>
      <Avatar providerId={providerId} status={d.state.status} />
      <span className="sr-row-txt">
        <span className="sr-row-title" title={d.title}>{d.title}</span>
        <RollingText className="sr-row-detail" text={detailLine(d)} />
      </span>
      <span className="sr-el">{formatDuration(elapsed(d, now))}</span>
    </li>
  );
}
