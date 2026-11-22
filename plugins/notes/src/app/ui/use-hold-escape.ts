import { useEffect } from "react";
import { holdEscape } from "./hold-escape.ts";

const ignore = () => undefined;

/** Holds Esc while `held`, handing each one nothing else took to `onEscape`. */
export function useHoldEscape(held: boolean, onEscape: () => void = ignore): void {
  useEffect(() => (held ? holdEscape(document, onEscape) : undefined), [held, onEscape]);
}
