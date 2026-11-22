// An issue link's hover card in chat: the Board's card for the issue (board/issue/hover-card), opened
// and closed as a board row's is (card-intent.ts), floating by the link, fixed in the window, so the
// message list clips none of it. bb renders the links, so the card hears the pointer and focus on the
// document: a link and its card are one place, so the pointer crossing from one to the other, or focus
// going back from the card to its link, keeps it. A press anywhere but on the card puts it away, and
// so does a scroll, which moves the link from under it. Escape closes it wherever focus is.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { coordinatorContract as contract } from "../../contract.ts";
import type { IssueLink } from "../../model/issue/link/issue-link.ts";
import { useCardIntent, type CardIntent } from "../board/issue/hover-card/card-intent.ts";
import { HoverCard } from "../board/issue/hover-card/hover-card.tsx";
import { issueLinkAt } from "./decorated-links.ts";

/** The card of the issue link the pointer rests on or focus is on; none while there is none. */
export function LinkCard(): ReactNode {
  const { shown, intent } = useCardIntent<HTMLAnchorElement>();
  useLinkTriggers(intent, shown);
  const found = shown?.isConnected ? issueLinkAt(shown) : null;
  return found === null ? null : createPortal(<IssueCard anchor={found.anchor} link={found.link} />, document.body);
}

// ------------------------------------------------------------------ layer 2

/** The floating card (hover-card.css `.rmi-card-floating`). */
const CARD = ".rmi-card-floating";

/** Tells the intent what the pointer and focus do on issue links and on the card of `shown`. */
function useLinkTriggers(intent: CardIntent<HTMLAnchorElement>, shown: HTMLAnchorElement | null): void {
  useEffect(() => {
    /** The link a node belongs to: the link it is in, or the shown link, for a node in its card. */
    const linkOf = (node: EventTarget | null): HTMLAnchorElement | null => issueLinkAt(node)?.anchor ?? (shown !== null && inCard(node) ? shown : null);
    /** Whether `node` is in the place of `link`: the link, or its card while it shows. */
    const within = (link: HTMLAnchorElement, node: EventTarget | null) => node instanceof Node && (link.contains(node) || (link === shown && inCard(node)));
    const crossing = (event: PointerEvent | FocusEvent, act: (link: HTMLAnchorElement) => void) => {
      const link = linkOf(event.target);
      if (link !== null && !within(link, event.relatedTarget)) act(link);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "touch") crossing(event, intent.enter);
    };
    const onOut = (event: PointerEvent) => crossing(event, intent.leave);
    const onFocusIn = (event: FocusEvent) => crossing(event, intent.focus);
    const onFocusOut = (event: FocusEvent) => crossing(event, intent.blur);
    const onPress = (event: PointerEvent) => {
      if (!inCard(event.target)) intent.press();
    };
    const onScroll = (event: Event) => {
      if (!inCard(event.target)) intent.close();
    };
    const stops = [
      listen("pointerover", onOver),
      listen("pointerout", onOut),
      listen("focusin", onFocusIn),
      listen("focusout", onFocusOut),
      // why capturing: bb's own handlers may stop a press or a scroll on its way up.
      listen("pointerdown", onPress, true),
      listen("scroll", onScroll, true),
    ];
    return () => stops.forEach((stop) => stop());
  }, [intent, shown]);
}

/** Listens on the document until the returned function is called. */
function listen<Type extends keyof DocumentEventMap>(type: Type, listener: (event: DocumentEventMap[Type]) => void, capture = false): () => void {
  document.addEventListener(type, listener, capture);
  return () => document.removeEventListener(type, listener, capture);
}

const inCard = (node: EventTarget | null): boolean => node instanceof Element && node.closest(CARD) !== null;

/** The Board's card for the issue, from its board's read; none until the read has it. */
function IssueCard({ anchor, link }: { anchor: HTMLAnchorElement; link: IssueLink }) {
  const issues = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId: link.coordinatorId } }).data?.issues;
  const issue = issues?.find(({ id }) => id === link.issueId);
  return issues === undefined || issue === undefined ? null : <HoverCard issue={issue} issues={issues} link={anchor} />;
}
