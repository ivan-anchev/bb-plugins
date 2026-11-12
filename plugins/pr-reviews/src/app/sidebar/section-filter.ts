// Which of the sidebar's sections the reader hides, kept in this browser's localStorage so the
// choice outlives a reload. Stored as the hidden keys, so a section added later shows by default.
import { useState } from "react";
import { SECTION_KEYS, type SectionKey } from "../../contract.ts";

const STORAGE_KEY = "bb-plugin-pr-reviews.sidebar.hidden-sections.v1";

type SectionStorage = Pick<Storage, "getItem" | "setItem">;

// Touches `localStorage` only inside each call: a browser that denies storage throws on access,
// and that must happen inside the read or write that catches it.
const browserStorage: SectionStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

export function useHiddenSections() {
  const [hidden, setHidden] = useState(() => readHiddenSections(browserStorage));
  const change = (next: SectionKey[]) => {
    setHidden(next);
    writeHiddenSections(browserStorage, next);
  };
  return [hidden, change] as const;
}

/**
 * The stored hidden sections in sidebar order. Storage that cannot be read, or holds unreadable
 * data, hides none; unknown keys are dropped.
 */
export function readHiddenSections(storage: SectionStorage): SectionKey[] {
  const stored = parseJson(readStored(storage));
  return Array.isArray(stored) ? SECTION_KEYS.filter((key) => stored.includes(key)) : [];
}

/** Saves the choice for the next load. A failed save only warns: the choice still holds for this session. */
export function writeHiddenSections(storage: SectionStorage, hidden: readonly SectionKey[]) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch (error) {
    console.warn("pr-reviews: could not save the sidebar's hidden sections; the choice lasts until reload.", error);
  }
}

export function withSectionShown(hidden: readonly SectionKey[], section: SectionKey, shown: boolean): SectionKey[] {
  return SECTION_KEYS.filter((key) => (key === section ? !shown : hidden.includes(key)));
}

// Storage the browser denies (blocked site data, a sandboxed frame) throws on access; it reads as nothing stored.
function readStored(storage: SectionStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
