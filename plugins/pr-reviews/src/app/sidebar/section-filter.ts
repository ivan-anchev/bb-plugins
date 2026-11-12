// Which of the sidebar's sections the reader hides, kept in this browser's localStorage so the
// choice outlives a reload. Stored as the hidden keys, so a section added later shows by default.
import { useState } from "react";
import { SECTION_KEYS, type SectionKey } from "../../contract.ts";

const STORAGE_KEY = "bb-plugin-pr-reviews.sidebar.hidden-sections.v1";

type SectionStorage = Pick<Storage, "getItem" | "setItem">;

export function useHiddenSections() {
  const [hidden, setHidden] = useState(() => readHiddenSections(localStorage));
  const change = (next: SectionKey[]) => {
    writeHiddenSections(localStorage, next);
    setHidden(next);
  };
  return [hidden, change] as const;
}

/** The stored hidden sections in sidebar order. Unreadable data hides none; unknown keys are dropped. */
export function readHiddenSections(storage: SectionStorage): SectionKey[] {
  const stored = parseJson(storage.getItem(STORAGE_KEY));
  return Array.isArray(stored) ? SECTION_KEYS.filter((key) => stored.includes(key)) : [];
}

export function writeHiddenSections(storage: SectionStorage, hidden: readonly SectionKey[]) {
  storage.setItem(STORAGE_KEY, JSON.stringify(hidden));
}

export function withSectionShown(hidden: readonly SectionKey[], section: SectionKey, shown: boolean): SectionKey[] {
  return SECTION_KEYS.filter((key) => (key === section ? !shown : hidden.includes(key)));
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
