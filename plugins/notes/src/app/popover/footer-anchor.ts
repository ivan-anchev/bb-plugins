declare const __BB_PLUGIN_ID__: string;

/** The gap between the sidebar's edge, or the window's when the button is hidden, and the popover. */
export const GAP = 8;

const ITEM = `[data-footer-item="plugin:${__BB_PLUGIN_ID__}/notes"]`;

/** The footer button, or null while it is not on screen (sidebar collapsed or hidden). */
export function footerButton(): HTMLElement | null {
  const button = document.querySelector<HTMLElement>(`${ITEM} button`);
  return button !== null && button.getClientRects().length > 0 ? button : null;
}

/**
 * A zero-width rect on the sidebar's right edge, as tall as the footer button: the popover sits
 * GAP to its right, bottom-aligned. Without the button, the window's bottom-left corner, GAP in.
 */
export function anchorRect(): DOMRect {
  const button = footerButton();
  const sidebar = button?.closest('[data-sidebar="sidebar"]');
  if (button == null || sidebar == null) return new DOMRect(0, window.innerHeight - GAP, 0, 0);
  const { top, height } = button.getBoundingClientRect();
  return new DOMRect(sidebar.getBoundingClientRect().right, top, 0, height);
}

/** Whether a pointer-down landed on the footer item, whose click toggles the popover itself. */
export function isFooterItem(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ITEM) !== null;
}
