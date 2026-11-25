// The Managers view's hover card: a tile's or a row's card is found by its manager's thread, says what
// manager-card-body.tsx says, and a press on an issue in it opens that issue, routed in place by bb.
import type { RefObject } from "react";
import type { ManagerModel, Managers } from "../../../model/activity.ts";
import { HoverCard, type CardOf, type ListFocus } from "../../card/hover-card.tsx";
import { ManagerCardBody } from "./manager-card-body.tsx";

type Props = {
  scroller: RefObject<HTMLElement | null>;
  managers: Managers;
  underWaySince: ReadonlyMap<string, number>;
  listFocus: ListFocus;
  onNavigate(): void;
};

export function ManagerCard({ scroller, managers, underWaySince, listFocus, onNavigate }: Props) {
  const cardOf = (key: string): CardOf | null => {
    const found = placeOf(managers, key);
    if (found === null) return null;
    const { manager, place } = found;
    const open = (close: () => void) => () => {
      close();
      onNavigate();
    };
    return { label: manager.thread.displayTitle, focusKey: key, place, body: (close) => <ManagerCardBody manager={manager} underWaySince={underWaySince} onOpen={open(close)} /> };
  };

  return <HoverCard scroller={scroller} listFocus={listFocus} cardOf={cardOf} focusShowsAtOnce />;
}

/**
 * The manager under `key` and where it stands: in the grid or the list, and its index there. why: the
 * tiles fill the grid in order and the rows stand in a column, so only one arriving or leaving before
 * it, or crossing between them, moves it.
 */
function placeOf({ pinned, unpinned }: Managers, key: string): { manager: ManagerModel; place: string } | null {
  for (const [where, list] of [["grid", pinned], ["list", unpinned]] as const) {
    const at = list.findIndex((m) => m.thread.id === key);
    if (at !== -1) return { manager: list[at], place: `${where}:${at}` };
  }
  return null;
}
