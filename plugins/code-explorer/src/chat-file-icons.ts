import type { PluginContentScriptRegistration } from "@get-bb/plugin-sdk/app";
import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeIconConfig } from "@pierre/trees";
import { FILE_LINK_SELECTOR, MENTION_SELECTOR, filePathOfLink, filePathOfMention } from "./chat-file-targets.ts";
import "./chat-file-icons.css";

const ICON_CLASS = "ce-chat-file-icon";
const SVG_NS = "http://www.w3.org/2000/svg";
const WORD_JOINER = "\u2060";
const WATCHED_ATTRIBUTES = ["href", "data-prompt-mention-resource"];

/** The colored `complete` icon set of @pierre/trees, with npm and TypeScript icons for their config files. */
const FILE_ICONS = {
  set: "complete",
  colored: true,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
  },
} satisfies FileTreeIconConfig;

const iconResolver = createFileTreeIconResolver(FILE_ICONS);

type IconTarget = { host: Element; path: string; placement: "link" | "mention" };

/** Draws colored file-type icons beside file links and @-mentions in chat. */
export const chatFileIcons: PluginContentScriptRegistration = {
  id: "chat-file-icons",
  mount() {
    const sprite = injectSprite();
    decorateWithin(document.body);
    const stopWatching = watchForChatContent(decorateWithin);
    return () => {
      stopWatching();
      sprite.remove();
      for (const icon of document.querySelectorAll(`.${ICON_CLASS}`)) icon.remove();
    };
  },
};

function decorateWithin(root: Element): void {
  for (const target of iconTargetsWithin(root)) placeIcon(target);
}

function iconTargetsWithin(root: Element): IconTarget[] {
  const links = elementsMatching(root, FILE_LINK_SELECTOR).flatMap((host) => {
    const path = filePathOfLink(host.getAttribute("href") ?? "");
    return path === null ? [] : [{ host, path, placement: "link" as const }];
  });
  const mentions = elementsMatching(root, MENTION_SELECTOR)
    .filter((host) => host.closest('[contenteditable="true"]') === null)
    .flatMap((host) => {
      const path = filePathOfMention(host.getAttribute("data-prompt-mention-resource") ?? "");
      return path === null ? [] : [{ host, path, placement: "mention" as const }];
    });
  return [...links, ...mentions];
}

function placeIcon({ host, path, placement }: IconTarget): void {
  const icon = iconResolver.resolveIcon("file-tree-icon-file", path);
  const placed = host.querySelector(`:scope > .${ICON_CLASS}`);
  if (placed?.getAttribute("data-icon-name") === icon.name) return;
  placed?.remove();
  const hostIcon = placement === "mention" ? host.querySelector(":scope > svg") : null;
  host.insertBefore(iconElement(icon.name, icon.token, placement), hostIcon ?? host.firstChild);
}

/** The icon, then a word joiner so a line never breaks between the icon and the file name. */
function iconElement(name: string, token: string | undefined, placement: IconTarget["placement"]): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = ICON_CLASS;
  icon.dataset.iconName = name;
  icon.dataset.iconToken = token ?? "default";
  icon.dataset.placement = placement;
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  icon.append(svg, WORD_JOINER);
  return icon;
}

/** Batches DOM changes into one pass per frame, over the parts of the page that changed. */
function watchForChatContent(decorate: (root: Element) => void): () => void {
  const changed = new Set<Element>();
  let frame: number | null = null;
  const flush = () => {
    frame = null;
    for (const root of changed) if (root.isConnected) decorate(root);
    changed.clear();
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) if (record.target instanceof Element) changed.add(record.target);
    frame ??= requestAnimationFrame(flush);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributeFilter: WATCHED_ATTRIBUTES });
  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

function elementsMatching(root: Element, selector: string): Element[] {
  const enclosing = root.closest(selector);
  return [...(enclosing === null ? [] : [enclosing]), ...root.querySelectorAll(selector)];
}

/**
 * Puts the icon symbols in the page once, so every icon is a `<use>`.
 * The Next.js symbol's gradient id is renamed: `a` is too generic for a page-wide id.
 */
function injectSprite(): HTMLElement {
  const holder = document.createElement("div");
  holder.className = "ce-chat-file-icon-sprite";
  holder.innerHTML = getBuiltInSpriteSheet(FILE_ICONS.set)
    .replaceAll('id="a"', 'id="ce-file-icon-gradient"')
    .replaceAll("url(#a)", "url(#ce-file-icon-gradient)");
  document.body.append(holder);
  return holder;
}
