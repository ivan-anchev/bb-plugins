// A pinned regional manager's tile in the Managers view's grid: its avatar, larger than a row's, and its
// name under it on one line, centred while it fits, fading at its end when it doesn't (app.css). No
// chrome: the avatar and name stand on the canvas. It behaves as a row does (manager-link.tsx); bb's
// menu's Unpin sends it back to the list.
import type { ManagerModel } from "../../../model/activity.ts";
import { FadingTitle } from "../../row/row.tsx";
import { ManagerAvatar } from "../avatar/manager-avatar.tsx";
import { ManagerLink } from "../manager-link.tsx";

// why: the row's 36 and about a fifth more reads as "slightly larger" beside the rows, not as another control; and it is a touch target's size.
const AVATAR = 44;

// why no title attribute: its tooltip would fight the hover card, whose title is the full name.
export function ManagerTile({ manager, onNavigate }: { manager: ManagerModel; onNavigate(): void }) {
  return (
    <ManagerLink manager={manager} className="as-pin" label={manager.thread.displayTitle} onNavigate={onNavigate}>
      {(following) => (
        <>
          <ManagerAvatar avatar={manager.look?.avatar ?? null} following={following} size={AVATAR} />
          <span className="as-pin-name">
            <FadingTitle text={manager.thread.displayTitle} />
          </span>
        </>
      )}
    </ManagerLink>
  );
}
