// The Managers view's hover card: a tile's or a row's card is found by its manager's thread, says what
// manager-card-body.tsx says, and a press on an issue in it opens that issue, routed in place by bb.
import type { RefObject } from "react";
import type { Managers } from "../../../model/activity.ts";
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
    const manager = [...managers.pinned, ...managers.unpinned].find((m) => m.thread.id === key);
    if (manager === undefined) return null;
    const open = (close: () => void) => () => {
      close();
      onNavigate();
    };
    // why its key as its place: the card follows its tile or row wherever it moves (tracksRow), so nothing re-places it.
    return { label: manager.thread.displayTitle, focusKey: key, place: key, body: (close) => <ManagerCardBody manager={manager} underWaySince={underWaySince} onOpen={open(close)} /> };
  };

  return <HoverCard scroller={scroller} listFocus={listFocus} cardOf={cardOf} focusShowsAtOnce tracksRow />;
}


