import { useEffect } from "react";
import { holdEscape } from "./hold-escape.ts";

const ignore = () => undefined;

// why the document, bubbling: everything on the page acts on the Esc first (the dialog's own
// dismiss, which prevents the Esc it takes), and bb's, on the window, comes after.
/** Holds Esc while `held`, handing each one nothing else took to `onEscape`. */
export function useHoldEscape(held: boolean, onEscape: () => void = ignore): void {
  useEffect(() => (held ? holdEscape(document, onEscape) : undefined), [held, onEscape]);
}
