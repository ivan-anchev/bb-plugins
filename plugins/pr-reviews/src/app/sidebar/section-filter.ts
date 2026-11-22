import { useState } from "react";
import { SECTION_KEYS, type SectionKey } from "../../contract.ts";

/** A set of sections the reader picked, saved under its own key. */
export type SectionSet = { storageKey: string; what: string };

export const HIDDEN_SECTIONS: SectionSet = { storageKey: "bb-plugin-pr-reviews.sidebar.hidden-sections.v1", what: "hidden sections" };
export const COLLAPSED_SECTIONS: SectionSet = { storageKey: "bb-plugin-pr-reviews.sidebar.collapsed-sections.v1", what: "folded sections" };

type SectionStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage: SectionStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

export function useSectionSet(set: SectionSet) {
  const [sections, setSections] = useState(() => readSectionSet(browserStorage, set));
  const change = (next: SectionKey[]) => {
    setSections(next);
    writeSectionSet(browserStorage, set, next);
  };
  return [sections, change] as const;
}

/**
 * The stored sections in sidebar order. Storage that cannot be read, or holds unreadable data,
 * holds none; unknown keys are dropped.
 */
export function readSectionSet(storage: SectionStorage, set: SectionSet): SectionKey[] {
  const stored = parseJson(readStored(storage, set.storageKey));
  return Array.isArray(stored) ? SECTION_KEYS.filter((key) => stored.includes(key)) : [];
}

/** Saves the choice for the next load. A failed save only warns: the choice still holds for this session. */
export function writeSectionSet(storage: SectionStorage, set: SectionSet, sections: readonly SectionKey[]) {
  try {
    storage.setItem(set.storageKey, JSON.stringify(sections));
  } catch (error) {
    console.warn(`pr-reviews: could not save the sidebar's ${set.what}; the choice lasts until reload.`, error);
  }
}

/** `sections` with `section` in it or out of it, in sidebar order. */
export function withSection(sections: readonly SectionKey[], section: SectionKey, included: boolean): SectionKey[] {
  return SECTION_KEYS.filter((key) => (key === section ? included : sections.includes(key)));
}

function readStored(storage: SectionStorage, key: string): string | null {
  try {
    return storage.getItem(key);
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
