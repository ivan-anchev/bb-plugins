// The Managers view's hover card: a row's card is found by its manager's thread, says what
// manager-card-body.tsx says, and a press on an issue in it opens that issue, routed in place by bb.
import type { RefObject } from "react";
import type { ManagerModel } from "../../../model/activity.ts";
import { HoverCard, type CardOf, type ListFocus } from "../../card/hover-card.tsx";
import { ManagerCardBody } from "./manager-card-body.tsx";

type Props = {
  scroller: RefObject<HTMLElement | null>;
  managers: readonly ManagerModel[];
  underWaySince: ReadonlyMap<string, number>;
  listFocus: ListFocus;
  onNavigate(): void;
};

export function ManagerCard({ scroller, managers, underWaySince, listFocus, onNavigate }: Props) {
  const cardOf = (key: string): CardOf | null => {
    const at = managers.findIndex((m) => m.thread.id === key);
    const manager = managers[at];
    if (manager === undefined) return null;
    const open = (close: () => void) => () => {
      close();
      onNavigate();
    };
    // why its index as its place: the rows stand in a column, so only one arriving or leaving above it moves it.
    return { label: manager.thread.displayTitle, focusKey: key, place: String(at), body: (close) => <ManagerCardBody manager={manager} underWaySince={underWaySince} onOpen={open(close)} /> };
  };

  return <HoverCard scroller={scroller} listFocus={listFocus} cardOf={cardOf} focusShowsAtOnce />;
}
