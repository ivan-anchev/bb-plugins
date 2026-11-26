// A regional manager's row in the Managers view: its avatar, its name, and under it one line, the first
// sentence of its latest reply; nothing else. Compact, one 30px line: a smaller avatar, the agent mark's
// size, and its name alone. It behaves as its tile does (manager-link.tsx); pinned from bb's menu, it
// leaves the list for the grid above.
import type { ManagerModel } from "../../model/activity.ts";
import { FadingTitle } from "../row/row.tsx";
import { ManagerAvatar } from "./avatar/manager-avatar.tsx";
import type { Follow } from "./avatar/use-following.ts";
import { ManagerLink } from "./manager-link.tsx";

// why: the agent mark's column in a thread's row (app.css .as-mark), so a compact manager's row lines up with one.
const COMPACT_AVATAR = 20;

type Props = { manager: ManagerModel; compact: boolean; follow: Follow; onNavigate(): void };

export function ManagerRow({ manager, compact, follow, onNavigate }: Props) {
  const t = manager.thread;
  const line = compact ? null : manager.line;
  const spoken = line === null ? t.displayTitle : `${t.displayTitle}, ${line}`;

  return (
    <ManagerLink manager={manager} className={compact ? "as-manager as-manager-compact" : "as-manager"} label={spoken} follow={follow} onNavigate={onNavigate}>
      {(following) => (
        <>
          <span className="as-manager-face">
            <ManagerAvatar avatar={manager.look?.avatar ?? null} following={following} size={compact ? COMPACT_AVATAR : undefined} />
          </span>
          <span className="as-manager-words">
            <FadingTitle text={t.displayTitle} />
            {line !== null && (
              <span className="as-manager-line">
                <FadingTitle text={line} />
              </span>
            )}
          </span>
        </>
      )}
    </ManagerLink>
  );
}
