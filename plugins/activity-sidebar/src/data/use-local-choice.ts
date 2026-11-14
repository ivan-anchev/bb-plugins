// The reader's own choices for this list (which sections are open, the project filter), kept in this
// browser's localStorage so they outlive a reload. Choices only: nothing derived is stored.
import { experimental_usePluginId as usePluginId } from "@get-bb/plugin-sdk/app";
import { useState } from "react";

export type ChoiceStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Reads what was stored as unknown JSON; `parse` turns it into the choice, or the default when nothing
 * readable is stored. Stored values are untrusted: another version or a hand edit may have written them.
 */
export type ParseChoice<T> = (stored: unknown) => T;

// Touches `localStorage` only inside each call: a browser that denies storage throws on access, and
// that must happen inside the read or write that catches it.
const browserStorage: ChoiceStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

/** A choice kept under `<plugin id>.<name>`: read once on mount, written on every change. */
export function useLocalChoice<T>(name: string, parse: ParseChoice<T>): [T, (next: T) => void] {
  const key = `${usePluginId()}.${name}`;
  const [value, setValue] = useState(() => readChoice(browserStorage, key, parse));
  const change = (next: T) => {
    setValue(next);
    writeChoice(browserStorage, key, next);
  };
  return [value, change];
}

/** The stored choice, or `parse(undefined)` when storage can't be read or holds no JSON. */
export function readChoice<T>(storage: ChoiceStorage, key: string, parse: ParseChoice<T>): T {
  return parse(parseJson(readStored(storage, key)));
}

/** Saves the choice for the next load. A failed save only warns: the choice still holds until reload. */
export function writeChoice(storage: ChoiceStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`activity-sidebar: could not save ${key}; the choice lasts until reload.`, error);
  }
}

// ------------------------------------------------------------------ layer 2

// Storage the browser denies (blocked site data, a sandboxed frame) throws on access: nothing stored.
function readStored(storage: ChoiceStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
