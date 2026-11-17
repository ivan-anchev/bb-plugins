// The PR sidebar's width in the wide layout, kept in this browser's localStorage so a drag outlives
// a reload. Clamped to bb's own sidebar range; the default is the width the sidebar always had.
import { useState } from "react";

export const SIDEBAR_WIDTH = { min: 240, max: 480, default: 288 } as const;

const KEYBOARD_STEP = 16;

const STORAGE_KEY = "bb-plugin-pr-reviews.sidebar.width.v1";

type WidthStorage = Pick<Storage, "getItem" | "setItem">;

// Touches `localStorage` only inside each call: a browser that denies storage throws on access,
// and that must happen inside the read or write that catches it.
const browserStorage: WidthStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

/** `resize` follows a drag without saving; `save` sets the width and keeps it for the next load. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => readSidebarWidth(browserStorage));
  const resize = (next: number) => setWidth(clampSidebarWidth(next));
  const save = (next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    writeSidebarWidth(browserStorage, clamped);
  };
  return { width, resize, save };
}

export function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), SIDEBAR_WIDTH.min), SIDEBAR_WIDTH.max);
}

/** The width a key moves the handle to, as the Changes tab's divider steps: arrows nudge, Home and End jump. */
export function sidebarWidthAfterKey(key: string, width: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSidebarWidth(width - KEYBOARD_STEP);
    case "ArrowRight":
      return clampSidebarWidth(width + KEYBOARD_STEP);
    case "Home":
      return SIDEBAR_WIDTH.min;
    case "End":
      return SIDEBAR_WIDTH.max;
    default:
      return null;
  }
}

/** The stored width, clamped. Storage that cannot be read, or holds no number, gives the default. */
export function readSidebarWidth(storage: WidthStorage): number {
  const stored = readStored(storage);
  const width = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_WIDTH.default;
}

/** Saves the width for the next load. A failed save only warns: the width still holds for this session. */
export function writeSidebarWidth(storage: WidthStorage, width: number) {
  try {
    storage.setItem(STORAGE_KEY, String(width));
  } catch (error) {
    console.warn("pr-reviews: could not save the sidebar's width; it lasts until reload.", error);
  }
}

// Storage the browser denies (blocked site data, a sandboxed frame) throws on access; it reads as nothing stored.
function readStored(storage: WidthStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
