// Which issue link a node is in: bb renders a message's Markdown link as an `<a href>` in its
// Markdown preview, and a link whose href is an issue's (model/issue/link) names that issue. Focus or
// the pointer in a link's floating card is on that link.
// why bb's markup: bb gives a plugin no renderer for a link inside a message (reports/BBP-28.md), so
// this rests on `[data-markdown-preview] a[href]`, and is experimental.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import { parseIssueHref, type IssueLink } from "../../../model/issue/link/issue-link.ts";
import { cardLinkOf } from "../card/link-hover-card.tsx";

/** An issue link on screen and the issue it names. */
export type FoundLink = { anchor: HTMLAnchorElement; link: IssueLink };

/** The issue link `node` belongs to: the link it is in, or the link the card it is in floats by; null for any other node. */
export function linkOfNode(node: EventTarget | null, linkAt: (target: EventTarget | null) => FoundLink | null): HTMLAnchorElement | null {
  return node instanceof Node ? (cardLinkOf(node) ?? linkAt(node)?.anchor ?? null) : null;
}

/** Whether `node` is in the place of `link`: the link, or the card that floats by it. */
export const inPlaceOf = (link: HTMLAnchorElement, node: EventTarget | null): boolean => node instanceof Node && (link.contains(node) || cardLinkOf(node) === link);

/** Finds the issue link `target` is in, and the issue it names; null outside one. Stable while the plugin's id is. */
export function useIssueLinkAt(): (target: EventTarget | null) => FoundLink | null {
  const pluginId = experimental_usePluginId();
  return useCallback((target) => {
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>(LINKS) : null;
    const link = anchor === null ? null : parseIssueHref(pluginId, anchor.getAttribute("href") ?? "");
    return anchor === null || link === null ? null : { anchor, link };
  }, [pluginId]);
}

/** A message's Markdown as bb renders it. */
export const MESSAGE = "[data-markdown-preview]";
/** Every link bb renders in a message's Markdown. */
export const LINKS = `${MESSAGE} a[href]`;
