// A regional manager's row in the Managers view: its avatar, its name, and under it one line, the first
// sentence of its latest reply; nothing else. It behaves as its tile does (manager-link.tsx); pinned
// from bb's menu, it leaves the list for the grid above.
import type { ManagerModel } from "../../model/activity.ts";
import { FadingTitle } from "../row/row.tsx";
import { ManagerAvatar } from "./avatar/manager-avatar.tsx";
import { ManagerLink } from "./manager-link.tsx";

export function ManagerRow({ manager, onNavigate }: { manager: ManagerModel; onNavigate(): void }) {
  const t = manager.thread;
  const spoken = manager.line === null ? t.displayTitle : `${t.displayTitle}, ${manager.line}`;

  return (
    <ManagerLink manager={manager} className="as-manager" label={spoken} onNavigate={onNavigate}>
      {(following) => (
        <>
          <span className="as-manager-face">
            <ManagerAvatar avatar={manager.look?.avatar ?? null} following={following} />
          </span>
          <span className="as-manager-words">
            <FadingTitle text={t.displayTitle} />
            {manager.line !== null && (
              <span className="as-manager-line">
                <FadingTitle text={manager.line} />
              </span>
            )}
          </span>
        </>
      )}
    </ManagerLink>
  );
}
