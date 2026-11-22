// Focus on an issue link that bb renders again, as a streamed reply does, goes to the link that
// replaces it in its message, or, once that message is gone too, to its pane's composer, never to the
// page (REVIEW.md). Focus in a link's card counts as focus on its link.
import { inPlaceOf, linkOfNode, MESSAGE, type FoundLink } from "./link-at.ts";

/**
 * The issue link that has focus, kept so that when bb renders it again its focus goes to the link
 * that replaces it: the one with its href at its place among them in its message, or, with the
 * message gone, the composer of its pane.
 */
export function focusKept(linkAt: (target: EventTarget | null) => FoundLink | null) {
  let kept: { anchor: HTMLAnchorElement; href: string; message: Element; index: number; composer: HTMLElement | null } | null = null;
  const withKept = (node: EventTarget | null) => kept !== null && inPlaceOf(kept.anchor, node);
  const onFocusIn = (event: FocusEvent) => {
    if (withKept(event.target)) return;
    // why the card's link: focus in a card's scrolling body, however it got there, is focus on the link it floats by, for when bb renders that link again.
    const anchor = linkOfNode(event.target, linkAt);
    kept = anchor === null ? null : keep(anchor);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (!withKept(event.target) || withKept(event.relatedTarget)) return;
    const left = kept;
    // why after the event: Chrome fires focusout while it takes a focused link out, with the link still in the page, so whether focus was moved or the link taken is known only once the removal is done. bb taking the link out is the case `restore` is for, and so is the user switching windows, which leaves the link focused; the user moving focus elsewhere in the page is not.
    queueMicrotask(() => {
      if (kept === left && left !== null && left.anchor.isConnected && !withKept(document.activeElement)) kept = null;
    });
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  return {
    /** Gives the focus the kept link lost to the page, as bb took it out, to what replaces it. */
    restore() {
      if (kept === null || kept.anchor.isConnected || !focusLost()) return;
      const links = sameLinks(kept.message, kept.href);
      const target = links[kept.index] ?? links.at(-1) ?? kept.composer;
      if (target?.isConnected) target.focus();
    },
    stop() {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** A pane's composer, where focus goes when the link it had and its message are gone. */
const COMPOSER = '[contenteditable="true"]';

/** Whether focus is on no element of the page: on its body, or on one taken out of it. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

function keep(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute("href") ?? "";
  const message = anchor.closest(MESSAGE) ?? anchor;
  return { anchor, href, message, index: sameLinks(message, href).indexOf(anchor), composer: composerOf(anchor) };
}

/** The links in `message` to `href`, in order; none once the message is out of the page. */
const sameLinks = (message: Element, href: string): HTMLAnchorElement[] => (message.isConnected ? [...message.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => a.getAttribute("href") === href) : []);

/** The composer of the pane `element` is in: the nearest one an ancestor of it holds. */
function composerOf(element: Element): HTMLElement | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const composer = at.querySelector<HTMLElement>(COMPOSER);
    if (composer !== null) return composer;
  }
  return null;
}
