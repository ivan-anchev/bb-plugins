// An issue link's hover card in chat: the Board's card for the issue (board/issue/hover-card, link-hover-card.tsx), opened
// and closed as a board row's is (card-intent.ts), floating by the link, fixed in the window, so the
// message list clips none of it. bb renders the links, so the card hears the pointer and focus on the
// document: a link and its card are one place, so the pointer crossing from one to the other, or focus
// going back from the card to its link, keeps it. A capped card's body, which scrolls, is the next tab
// stop after its link and the previous before what follows it, as a board row's card is. A press
// anywhere but on the card puts it away; a scroll moves it with its link, and takes it away once the
// link can't be seen (floating-placement.ts). Escape closes it wherever focus is.
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { IssueLink } from "../../../model/issue/link/issue-link.ts";
import { useCardIntent, type CardIntent } from "../../board/issue/hover-card/card-intent.ts";
import { useBoardIssue } from "../../board/use-board-issue.ts";
import type { DecoratedLink } from "../links/decorated-links.ts";
import { inPlaceOf, linkOfNode, useIssueLinkAt, type FoundLink } from "../links/link-at.ts";
import { cappedBodyOf, cardLinkOf, LinkHoverCard } from "./link-hover-card.tsx";

/** The card of the issue link the pointer rests on or focus is on, among the decorated `links`; none while there is none, or once bb took the link out. */
export function LinkCard({ links }: { links: readonly DecoratedLink[] }): ReactNode {
  const { shown, intent } = useCardIntent<HTMLAnchorElement>();
  const linkAt = useIssueLinkAt();
  useLinkTriggers(intent, shown, linkAt);
  const found = shown === null ? undefined : links.find(({ slot }) => slot.parentElement === shown);
  return shown === null || found === undefined ? null : createPortal(<IssueCard anchor={shown} link={found.link} intent={intent} />, document.body);
}

// ------------------------------------------------------------------ layer 2

/** Tells the intent what the pointer, focus, Tab and presses do on issue links and on the card of `shown`. */
function useLinkTriggers(intent: CardIntent<HTMLAnchorElement>, shown: HTMLAnchorElement | null, linkAt: (target: EventTarget | null) => FoundLink | null): void {
  useEffect(() => {
    const crossing = (event: PointerEvent | FocusEvent, act: (link: HTMLAnchorElement) => void) => {
      const link = linkOfNode(event.target, linkAt);
      if (link !== null && !inPlaceOf(link, event.relatedTarget)) act(link);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "touch") crossing(event, intent.enter);
    };
    const onPress = (event: PointerEvent) => {
      if (!inCard(event.target)) intent.press();
    };
    const onTab = (event: KeyboardEvent) => {
      if (event.key === "Tab" && shown !== null) tabThroughCard(event, shown);
    };
    const stops = [
      listen("pointerover", onOver),
      listen("pointerout", (event) => crossing(event, intent.leave)),
      listen("focusin", (event) => crossing(event, intent.focus)),
      listen("focusout", (event) => crossing(event, intent.blur)),
      listen("keydown", onTab),
      // why capturing: bb's own handlers may stop a press on its way up.
      listen("pointerdown", onPress, true),
    ];
    return () => stops.forEach((stop) => stop());
  }, [intent, shown, linkAt]);
}

/**
 * Puts a capped card's body, the one tab stop it has, between its link and what follows it: Tab on
 * the link goes into it, and Tab or Shift+Tab from it goes on from the link. why by hand: the card
 * floats at the end of the page, outside bb's message, where the browser's own order would never
 * reach it before the card closes.
 */
function tabThroughCard(event: KeyboardEvent, link: HTMLAnchorElement): void {
  const body = cappedBodyOf(link);
  if (body === null) return;
  if (event.target === link && !event.shiftKey) {
    event.preventDefault();
    body.focus();
  } else if (event.target === body) {
    // why Tab goes on by default: the browser moves on from the link, now focused, to what follows it.
    link.focus();
    if (event.shiftKey) event.preventDefault();
  }
}

/** Listens on the document until the returned function is called. */
function listen<Type extends keyof DocumentEventMap>(type: Type, listener: (event: DocumentEventMap[Type]) => void, capture = false): () => void {
  document.addEventListener(type, listener, capture);
  return () => document.removeEventListener(type, listener, capture);
}

const inCard = (node: EventTarget | null): boolean => node instanceof Node && cardLinkOf(node) !== undefined;

/** The Board's card for the issue, from its board's read, with why a later read failed; none until a read has it, or for an issue the board has none of. */
function IssueCard({ anchor, link, intent }: { anchor: HTMLAnchorElement; link: IssueLink; intent: CardIntent<HTMLAnchorElement> }) {
  const { read, issues, issue } = useBoardIssue(link.coordinatorId, link.issueId);
  const presence = intent.presence(anchor);
  if (issues === undefined || issue === undefined) return null;
  return <LinkHoverCard issue={issue} issues={issues} link={anchor} presence={presence} failure={read.error?.message} />;
}
