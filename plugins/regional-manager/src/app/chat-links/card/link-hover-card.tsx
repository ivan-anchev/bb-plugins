// An issue link's card in chat: the Board's card (board/issue/hover-card), floating, fixed in the
// window by its link (floating-placement.ts), so the message list clips none of it. The card knows
// its link, so focus or the pointer in the card is on that link (cardLinkOf), and the link knows its
// card's scrolling body, its tab stop while the card is capped (cappedBodyOf).
import { useCallback, type RefObject } from "react";
import { Card, type HoverCardProps } from "../../board/issue/hover-card/hover-card.tsx";
import { useFloatingPlacement } from "./floating-placement.ts";

export function LinkHoverCard({ link, ...props }: HoverCardProps & { link: HTMLAnchorElement }) {
  const { ref, body, placement } = useFloatingPlacement(link, props.presence.close);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element;
      if (element === null) return;
      cardLinks.set(element, link);
      linkBodies.set(link, body);
    },
    [ref, body, link],
  );
  const trigger = useCallback(() => link, [link]);
  return <Card {...props} attach={attach} place={{ kind: "floating", placement, body }} className={`rmi-card ${FLOATING_CARD}`} trigger={trigger} />;
}

/** The link the floating card `node` is in floats by, while it is mounted; undefined outside one: focus or the pointer in the card is on that link. */
export function cardLinkOf(node: Node): HTMLAnchorElement | undefined {
  const card = (node instanceof Element ? node : node.parentElement)?.closest(`.${FLOATING_CARD}`);
  return card === null || card === undefined ? undefined : cardLinks.get(card);
}

/** The scrolling body of the card floating by `link`, its one tab stop, while the card is mounted and capped; null otherwise. */
export function cappedBodyOf(link: HTMLAnchorElement): HTMLElement | null {
  const body = linkBodies.get(link)?.current ?? null;
  return body !== null && body.tabIndex === 0 ? body : null;
}

// ------------------------------------------------------------------ layer 2

/** A link's card, floating in the window (chat-links.css). */
const FLOATING_CARD = "rmi-card-floating";

/** The link each mounted floating card floats by. */
const cardLinks = new WeakMap<Element, HTMLAnchorElement>();
/** Each link's card's body, which React empties as the card unmounts. */
const linkBodies = new WeakMap<HTMLAnchorElement, RefObject<HTMLDivElement | null>>();
