// What a portaled overlay needs: the attributes bb's overlay layer expects on it (focus, dismiss,
// stacking), and to close when the panel it was opened from is hidden, so nothing it portals stays
// over the other panel.
import { createContext, useContext, useState } from "react";

declare const __BB_PLUGIN_ID__: string;

export const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };

/** Whether the panel holding this part of the sidebar is the one shown (ui/managers/sidebar-views.tsx); true with no panels. */
export const PanelShown = createContext(true);

export const usePanelShown = (): boolean => useContext(PanelShown);

/**
 * An overlay's open state that closes, and stays closed, once its panel is hidden: it opens again
 * only by the reader's own act.
 */
export function useOverlayOpen(): [boolean, (open: boolean) => void] {
  const shown = usePanelShown();
  const [open, setOpen] = useState(false);
  // why: React's "adjust state when a prop changes": closed in the render that hides the panel.
  if (open && !shown) setOpen(false);
  return [open, setOpen];
}
