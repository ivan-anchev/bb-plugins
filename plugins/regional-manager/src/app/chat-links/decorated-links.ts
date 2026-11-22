// The issue links in messages bb rendered, each given a slot its glyph is drawn in. bb renders a
// message's Markdown link as an `<a href>` in its Markdown preview; a link whose href is an issue's
// (model/issue/link) gets an element of the plugin's own, put first in the link, which the overlay
// portals the issue's glyph into (issue-links.tsx). The page follows the DOM as messages come, stream
// and go: a link that bb renders again, as a new element or with its children replaced, has lost its
// slot and gets a new one, and a link whose href changes, to another issue's or to anything else,
// loses the slot it had. A link in code is no `<a>`, and a bare id is text: neither is touched.
// why touch bb's DOM: bb gives a plugin no renderer for a link inside a message (reports/BBP-28.md),
// so this rests on bb's markup, `[data-markdown-preview] a[href]`, and is experimental.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { parseIssueHref, type IssueLink } from "../../model/issue/link/issue-link.ts";

/** An issue link on screen and the slot its glyph goes in. `key`: its own, for the portal. */
export type DecoratedLink = { key: number; link: IssueLink; slot: HTMLElement };

/** Every issue link on screen, each with its slot, following the DOM; the slots go as the page does. */
export function useDecoratedLinks(): readonly DecoratedLink[] {
  const [links, setLinks] = useState<readonly DecoratedLink[]>([]);
  const linkAt = useIssueLinkAt();
  useEffect(() => {
    let next = 0;
    const slots = new Set<HTMLElement>();
    /** One pass over the page; one that finds nothing to change writes nothing, to the page or to React. */
    const scan = () => {
      removeStale(linkAt);
      const fresh = undecorated(linkAt).map(({ anchor, link }) => ({ key: next++, link, slot: decorate(anchor) }));
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
      if (frame !== null || records.every(isOwnWrite)) return;
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

/** Every link bb renders in a message's Markdown. */
const LINKS = "[data-markdown-preview] a[href]";
/** The glyph's slot (chat-links.css). */
const SLOT = "rmi-issue-glyph";

/** A change only the plugin made: inside a slot (its glyph), or adding or removing slots alone. */
function isOwnWrite({ target, addedNodes, removedNodes }: MutationRecord): boolean {
  const changed = [...addedNodes, ...removedNodes];
  return inSlot(target) || (changed.length > 0 && changed.every(inSlot));
}

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
function removeStale(linkAt: (target: Element) => FoundLink | null): void {
  for (const slot of document.querySelectorAll<HTMLElement>(`.${SLOT}`)) {
    const anchor = slot.parentElement;
    if (anchor === null || linkAt(anchor) === null || anchor.getAttribute("href") !== slot.dataset.href) slot.remove();
  }
}

/** Puts a new slot first in the link, for the href it has now, in place of one it had for another. */
function decorate(anchor: HTMLAnchorElement): HTMLElement {
  slotOf(anchor)?.remove();
  const slot = document.createElement("span");
  slot.className = SLOT;
  slot.dataset.href = anchor.getAttribute("href") ?? "";
  anchor.prepend(slot);
  return slot;
}

const slotOf = (anchor: HTMLAnchorElement): HTMLElement | null => anchor.querySelector<HTMLElement>(`:scope > .${SLOT}`);
