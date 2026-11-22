// The issue links in messages bb rendered, each given a slot its glyph is drawn in. bb renders a
// message's Markdown link as an `<a href>` in its Markdown preview; a link whose href is an issue's
// (model/issue/link) gets an element of the plugin's own, put first in the link, which the overlay
// portals the issue's glyph into (issue-links.tsx). The page follows the DOM as messages come, stream
// and go: a link that bb renders again, as a new element or with its children replaced, has lost its
// slot and gets a new one, and a link whose href changes, to another issue's or to anything else,
// loses the slot it had. Focus on a link bb renders again goes to the link that replaces it in its
// message, or, once that message is gone too, to its pane's composer, never to the page. A link in code is no `<a>`, and a bare id is text: neither is touched.
// why touch bb's DOM: bb gives a plugin no renderer for a link inside a message (reports/BBP-28.md),
// so this rests on bb's markup, `[data-markdown-preview] a[href]`, and is experimental.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { parseIssueHref, type IssueLink } from "../../model/issue/link/issue-link.ts";
import { FLOATING_CARD, linkOfCard } from "../board/issue/hover-card/hover-card.tsx";

/** An issue link on screen and the slot its glyph goes in. `key`: its own, for the portal. */
type DecoratedLink = { key: number; link: IssueLink; slot: HTMLElement };

/** Every issue link on screen, each with its slot, following the DOM; the slots go as the page does. */
export function useDecoratedLinks(): readonly DecoratedLink[] {
  const [links, setLinks] = useState<readonly DecoratedLink[]>([]);
  const linkAt = useIssueLinkAt();
  useEffect(() => {
    let next = 0;
    const slots = new Set<HTMLElement>();
    const own = ownWrites();
    const focus = focusKept(linkAt);
    /** One pass over the page; one that finds nothing to change writes nothing, to the page or to React. */
    const scan = () => {
      focus.restore();
      removeStale(linkAt, own);
      const fresh = undecorated(linkAt).map(({ anchor, link }) => ({ key: next++, link, slot: decorate(anchor, own) }));
      const gone = [...slots].filter((slot) => !slot.isConnected);
      if (fresh.length === 0 && gone.length === 0) return;
      for (const slot of gone) slots.delete(slot);
      for (const { slot } of fresh) slots.add(slot);
      setLinks((current) => [...current.filter(({ slot }) => slot.isConnected), ...fresh]);
    };
    // why at most one pass a frame, and none for the plugin's own writes: a pass writes to the page it
    // watches (a slot, the glyph in it), and a streamed reply changes it many times a frame.
    let frame: number | null = null;
    const schedule = (records: MutationRecord[]) => {
      if (frame !== null || records.every(own.made)) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        scan();
      });
    };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    return () => {
      observer.disconnect();
      focus.stop();
      if (frame !== null) cancelAnimationFrame(frame);
      for (const slot of document.querySelectorAll(`.${SLOT}`)) slot.remove();
    };
  }, [linkAt]);
  return links;
}

/** An issue link on screen and the issue it names. */
export type FoundLink = { anchor: HTMLAnchorElement; link: IssueLink };

/** Finds the issue link `target` is in, and the issue it names; null outside one. Stable while the plugin's id is. */
export function useIssueLinkAt(): (target: EventTarget | null) => FoundLink | null {
  const pluginId = experimental_usePluginId();
  return useCallback((target) => {
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>(LINKS) : null;
    const link = anchor === null ? null : parseIssueHref(pluginId, anchor.getAttribute("href") ?? "");
    return anchor === null || link === null ? null : { anchor, link };
  }, [pluginId]);
}

// ------------------------------------------------------------------ layer 2

/** A message's Markdown as bb renders it. */
const MESSAGE = "[data-markdown-preview]";
/** Every link bb renders in a message's Markdown. */
const LINKS = `${MESSAGE} a[href]`;
/** A pane's composer, where focus goes when the link it had and its message are gone. */
const COMPOSER = '[contenteditable="true"]';
/** The glyph's slot (chat-links.css). */
const SLOT = "rmi-issue-glyph";

/**
 * The issue link that has focus, kept so that when bb renders it again its focus goes to the link
 * that replaces it: the one with its href at its place among them in its message, or, with the
 * message gone, the composer of its pane.
 */
function focusKept(linkAt: (target: EventTarget | null) => FoundLink | null) {
  let kept: { anchor: HTMLAnchorElement; href: string; message: Element; index: number; composer: HTMLElement | null } | null = null;
  /** Whether `node` is in the place of the kept link: the link, or the card that floats by it. */
  const withKept = (node: EventTarget | null) => node instanceof Node && kept !== null && (kept.anchor.contains(node) || cardLinkOf(node) === kept.anchor);
  const onFocusIn = (event: FocusEvent) => {
    if (withKept(event.target)) return;
    // why the card's link: focus in a card's scrolling body, however it got there, is focus on the link it floats by, for when bb renders that link again.
    const anchor = event.target instanceof Node ? (cardLinkOf(event.target) ?? linkAt(event.target)?.anchor ?? null) : null;
    kept = anchor instanceof HTMLAnchorElement ? keep(anchor) : null;
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

/** The link the floating card `node` is in floats by; undefined outside one. */
function cardLinkOf(node: Node): HTMLElement | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  const card = element?.closest(FLOATING_CARD) ?? null;
  return card === null ? undefined : linkOfCard(card);
}

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

/** The slots the plugin put in and took out itself, and whether a change is only that, or inside a slot (its glyph). */
function ownWrites() {
  const added = new WeakSet<Node>();
  const removed = new WeakSet<Node>();
  return {
    added: (slot: Node) => void added.add(slot),
    removed: (slot: Node) => void removed.add(slot),
    // why by the nodes it wrote, not the record's shape: bb taking a slot out of a link it keeps is bb's change, which brings the slot back.
    made: ({ target, addedNodes, removedNodes }: MutationRecord): boolean =>
      inSlot(target) || (addedNodes.length + removedNodes.length > 0 && [...addedNodes].every((node) => added.has(node)) && [...removedNodes].every((node) => removed.has(node))),
  };
}

type OwnWrites = ReturnType<typeof ownWrites>;

function inSlot(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element !== null && element.closest(`.${SLOT}`) !== null;
}

/** The issue links with no slot for the href they have now. */
function undecorated(linkAt: (target: Element) => FoundLink | null): FoundLink[] {
  return [...document.querySelectorAll(LINKS)].flatMap((anchor) => {
    const found = linkAt(anchor);
    return found === null || slotOf(found.anchor)?.dataset.href === found.anchor.getAttribute("href") ? [] : [found];
  });
}

/** Takes out every slot whose link no longer has the issue href it was made for: an href changed, or taken away. */
function removeStale(linkAt: (target: Element) => FoundLink | null, own: OwnWrites): void {
  for (const slot of document.querySelectorAll<HTMLElement>(`.${SLOT}`)) {
    const anchor = slot.parentElement;
    if (anchor === null || linkAt(anchor) === null || anchor.getAttribute("href") !== slot.dataset.href) remove(slot, own);
  }
}

function remove(slot: HTMLElement, own: OwnWrites): void {
  own.removed(slot);
  slot.remove();
}

/** Puts a new slot first in the link, for the href it has now, in place of one it had for another. */
function decorate(anchor: HTMLAnchorElement, own: OwnWrites): HTMLElement {
  const old = slotOf(anchor);
  if (old !== null) remove(old, own);
  const slot = document.createElement("span");
  own.added(slot);
  slot.className = SLOT;
  slot.dataset.href = anchor.getAttribute("href") ?? "";
  anchor.prepend(slot);
  return slot;
}

const slotOf = (anchor: HTMLAnchorElement): HTMLElement | null => anchor.querySelector<HTMLElement>(`:scope > .${SLOT}`);
