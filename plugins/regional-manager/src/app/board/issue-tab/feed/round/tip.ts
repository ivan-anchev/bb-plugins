// A tooltip's lifetime, for what in a round says more of itself in one: a criterion's cell
// (criteria-grid.tsx) and a finding's place (findings.tsx). Shown while the pointer is on its slot,
// the trigger and the tip, which touch, or focus is on its trigger; Escape closes it wherever focus is.
import { useId, useState } from "react";
import { useEscapeToClose } from "../../../../ui/hold-escape.ts";

export function useTip() {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hovered || focused) && !dismissed;
  useEscapeToClose(shown, () => setDismissed(true));
  return {
    id,
    shown,
    slot: {
      onMouseEnter: () => {
        setHovered(true);
        setDismissed(false);
      },
      onMouseLeave: () => setHovered(false),
    },
    trigger: {
      onFocus: () => {
        setFocused(true);
        setDismissed(false);
      },
      onBlur: () => setFocused(false),
    },
  };
}
