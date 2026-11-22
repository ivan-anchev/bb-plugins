// The issue links in messages bb rendered, each given a slot its glyph is drawn in. bb renders a
// message's Markdown link as an `<a href>` in its Markdown preview; a link whose href is an issue's
// (model/issue/link) gets an element of the plugin's own, put first in the link, which the overlay
// portals the issue's glyph into (issue-links.tsx). The page follows the DOM as messages come, stream
// and go: a link that bb renders again, as a new element or with its children replaced, has lost its
// slot and gets a new one. A link in code is no `<a>`, and a bare id is text: neither is touched.
// why touch bb's DOM: bb gives a plugin no renderer for a link inside a message (reports/BBP-28.md),
// so this rests on bb's markup, `[data-markdown-preview] a[href]`, and is experimental.
import { useEffect, useState } from "react";
import { parseIssueHref, type IssueLink } from "../../model/issue/link/issue-link.ts";

/** An issue link on screen and the slot its glyph goes in. `key`: its own, for the portal. */
export type DecoratedLink = { key: number; link: IssueLink; slot: HTMLElement };

/** Every issue link on screen, each with its slot, following the DOM; the slots go as the page does. */
export function useDecoratedLinks(): readonly DecoratedLink[] {
  const [links, setLinks] = useState<readonly DecoratedLink[]>([]);
  useEffect(() => {
    let next = 0;
    const scan = () => {
      const fresh = undecorated().map(({ anchor, link }) => ({ key: next++, link, slot: decorate(anchor) }));
      setLinks((current) => {
        const kept = current.filter(({ slot }) => slot.isConnected);
        return fresh.length === 0 && kept.length === current.length ? current : [...kept, ...fresh];
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    return () => {
      observer.disconnect();
      for (const slot of document.querySelectorAll(`.${SLOT}`)) slot.remove();
    };
  }, []);
  return links;
}

/** The issue link `target` is in, and the issue it names; null outside one. */
export function issueLinkAt(target: EventTarget | null): { anchor: HTMLAnchorElement; link: IssueLink } | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>(LINKS) : null;
  const link = anchor === null ? null : parseIssueHref(anchor.getAttribute("href") ?? "");
  return anchor === null || link === null ? null : { anchor, link };
}

// ------------------------------------------------------------------ layer 2

/** Every link bb renders in a message's Markdown. */
const LINKS = "[data-markdown-preview] a[href]";
/** The glyph's slot (chat-links.css). */
const SLOT = "rmi-issue-glyph";

/** The issue links with no slot for the href they have now. */
function undecorated(): { anchor: HTMLAnchorElement; link: IssueLink }[] {
  return [...document.querySelectorAll(LINKS)].flatMap((anchor) => {
    const found = issueLinkAt(anchor);
    return found === null || slotOf(found.anchor)?.dataset.href === found.anchor.getAttribute("href") ? [] : [found];
  });
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
