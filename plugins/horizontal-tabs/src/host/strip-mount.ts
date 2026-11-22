import type { PluginContentScriptRegistration } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { type ChromeInset, followChromeInset } from "./chrome-inset.ts";

const SHELL = "[data-app-content-shell]";

const NO_INSET: ChromeInset = { classes: "" };

let slot: HTMLElement | null = null;
let inset: ChromeInset = NO_INSET;
const listeners = new Set<() => void>();

export const stripMount: PluginContentScriptRegistration = {
  id: "strip-mount",
  mount({ signal }) {
    const element = document.createElement("div");
    element.setAttribute("data-ht-strip-slot", "");
    const focus = keepFocus(element, signal);
    const chromeInset = followChromeInset(signal, (next) => {
      inset = next;
      notify();
    });
    const sync = () => {
      if (attach(element)) focus.restore();
      chromeInset.follow();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    publish(element);
    return () => {
      observer.disconnect();
      element.remove();
      inset = NO_INSET;
      publish(null);
    };
  },
};

/** The strip's portal target, or null while the content script is not mounted. */
export function useStripSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot);
}

/** The strip's inset spacer (src/host/chrome-inset.ts); none while nothing is followed. */
export function useChromeInset(): ChromeInset {
  return useSyncExternalStore(subscribe, () => inset);
}

/**
 * The strip is on screen: its slot sits in bb's shell and app.css doesn't hide it, as it does where bb is
 * compact. Read from the slot, so the compact breakpoint is stated once, in app.css.
 */
export function stripShown(): boolean {
  return slot !== null && slot.checkVisibility();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: HTMLElement | null): void {
  slot = next;
  notify();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function attach(element: HTMLElement): boolean {
  const shell = document.querySelector(SHELL);
  if (shell === null || element.parentElement === shell) return false;
  shell.prepend(element);
  return true;
}

function keepFocus(element: HTMLElement, signal: AbortSignal) {
  let held: HTMLElement | null = null;
  element.addEventListener(
    "focusout",
    (event) => {
      if (event.relatedTarget !== null || !(event.target instanceof HTMLElement)) return;
      held = event.target;
      setTimeout(() => {
        if (element.isConnected) held = null;
      });
    },
    { signal },
  );
  return {
    restore(): void {
      if (held !== null && document.activeElement === document.body) held.focus({ preventScroll: true });
      held = null;
    },
  };
}
