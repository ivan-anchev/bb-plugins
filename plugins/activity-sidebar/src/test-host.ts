// Tests only: what the browser and bb's own menus do that jsdom and the SDK's test slot don't, as far
// as the sidebar's tests need. Import it after test-browser.ts.
import type { experimental_ThreadActionsContextMenu } from "@get-bb/plugin-sdk/app";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { createElement, useEffect, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";

/**
 * Mounts bb's thread menu as the host runs it in place of the SDK's test menu, which stays inline in
 * its row: a hidden panel would hide that menu whether it closed or not.
 */
export function installHostThreadMenu() {
  installTestPluginRuntime();
  const runtime = (globalThis as unknown as { __bbPluginRuntime: { pluginSdkApp: Record<string, unknown> } }).__bbPluginRuntime;
  // why: renderSlot installs the runtime again with this same object, so the double has to go on it.
  Object.assign(runtime.pluginSdkApp, { experimental_ThreadActionsContextMenu: HostThreadMenu });
}

/**
 * The browser's ResizeObserver, as far as these tests need: `deliver` is the page laying out, telling
 * every observer still connected to measure again.
 */
export class PageResizeObserver implements ResizeObserver {
  private static readonly live = new Set<PageResizeObserver>();
  static deliver() {
    for (const observer of PageResizeObserver.live) observer.callback([], observer);
  }
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    PageResizeObserver.live.add(this);
  }
  unobserve() {}
  disconnect() {
    PageResizeObserver.live.delete(this);
  }
}

// ------------------------------------------------------------------ layer 2

/**
 * bb's thread menu as the host runs it (its desktop context menu): portaled to the page, outside the
 * row's panel; focus moves into it and, closed, back to where it was. `disabled` and `dragging` keep it
 * from opening, and `dragging` closes it once open.
 */
function HostThreadMenu({ children, disabled = false, dragging = false, onOpenChange, onCloseAutoFocus }: ComponentProps<typeof experimental_ThreadActionsContextMenu>) {
  // why: open, it holds where focus was; closed, null.
  const [returnTo, setReturnTo] = useState<Element | null>(null);
  const show = () => {
    if (disabled || dragging) return;
    setReturnTo(document.activeElement);
    onOpenChange?.(true);
  };
  const close = () => {
    setReturnTo(null);
    onOpenChange?.(false);
    const event = new Event("focus", { cancelable: true });
    onCloseAutoFocus?.(event);
    if (!event.defaultPrevented && returnTo instanceof HTMLElement) returnTo.focus();
  };
  useEffect(() => {
    if (dragging && returnTo !== null) close();
  }, [dragging, returnTo]);
  const menu = createElement("div", { role: "menu", tabIndex: -1, ref: (node: HTMLElement | null) => node?.focus() }, createElement("div", { role: "menuitem" }, "Archive"));
  return createElement(
    "div",
    {
      style: { display: "contents" },
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        show();
      },
    },
    children,
    returnTo !== null && createPortal(menu, document.body),
  );
}
