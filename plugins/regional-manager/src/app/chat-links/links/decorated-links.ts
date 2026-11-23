// The issue links in messages bb rendered (link-at.ts), each given a slot its glyph is drawn in: an
// element of the plugin's own, put first in the link, which the overlay portals the issue's glyph
// into (issue-links.tsx). The page follows the DOM as messages come, stream and go: a link that bb
// renders again, as a new element or with its children replaced, has lost its slot and gets a new
// one, and a link whose href changes, to another issue's or to anything else, loses the slot it had;
// each pass first gives focus the page lost with a link back (kept-focus.ts). A link in code is no
// `<a>`, and a bare id is text: neither is touched.
import { useEffect, useState } from "react";
import type { IssueLink } from "../../../model/issue/link/issue-link.ts";
import { focusKept } from "./kept-focus.ts";
import { LINKS, useIssueLinkAt, type FoundLink } from "./link-at.ts";

/** An issue link on screen and the slot its glyph goes in. `key`: its own, for the portal. */
export type DecoratedLink = { key: number; link: IssueLink; slot: HTMLElement };

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

// ------------------------------------------------------------------ layer 2

/** The glyph's slot (chat-links.css). */
const SLOT = "rmi-issue-glyph";

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
