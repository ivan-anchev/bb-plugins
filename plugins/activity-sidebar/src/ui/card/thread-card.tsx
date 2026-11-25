// The threads' list's hover card: a row's card is found by its section and thread where the list lays
// it out, says what card-body.tsx says, and a press in it opens the thread it names.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { RefObject } from "react";
import type { ListItem } from "../../list/items.ts";
import type { LayoutEntry } from "../../list/layout.ts";
import type { ThreadIndex } from "../../model/thread-index.ts";
import { CardBody } from "./card-body.tsx";
import { HoverCard, type CardOf, type ListFocus } from "./hover-card.tsx";

/** What a card reads beyond its row: who hangs under whom, and since when each thread has worked. */
export type CardData = { index: ThreadIndex; underWaySince: ReadonlyMap<string, number> };

export type RowItem = Extract<ListItem, { kind: "row" }>;

/**
 * A row in its place: its section and thread. A row that moves to another section (archived, put to
 * sleep, done working) is another row, so its card goes with the old one.
 */
export function cardKeyOf(item: RowItem): string {
  return `${item.section}/${item.row.thread.id}`;
}

type Props = { scroller: RefObject<HTMLElement | null>; entries: readonly LayoutEntry[]; data: CardData; listFocus: ListFocus; onNavigate(): void };

export function ThreadCard({ scroller, entries, data, listFocus, onNavigate }: Props) {
  const navigate = useBbNavigate();

  const cardOf = (key: string): CardOf | null => {
    const entry = entries.find(({ item }) => item.kind === "row" && cardKeyOf(item) === key);
    if (entry === undefined || entry.item.kind !== "row") return null;
    const item = entry.item;
    const open = (close: () => void) => (threadId: string) => {
      close();
      navigate.toThread(threadId);
      onNavigate();
    };
    return { label: item.row.thread.displayTitle, focusKey: item.key, place: `${entry.y}/${entry.h}`, body: (close) => <CardBody item={item} data={data} onOpen={open(close)} /> };
  };

  return <HoverCard scroller={scroller} listFocus={listFocus} cardOf={cardOf} focusShowsAtOnce={false} />;
}
