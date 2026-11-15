// Radix's dialog gives focus back to its Trigger when it closes, and the Spotlight has none: a
// shortcut, a sidebar button or a card link opens it. So it gives focus back to whatever had focus
// when it opened instead.
import { useState } from "react";

/**
 * For the dialog's `onCloseAutoFocus`. Call it in the component mounted with the dialog's content,
 * so it reads the focus before the dialog takes it.
 */
export function useReturnFocus(): (event: Event) => void {
  const [opener] = useState(() => document.activeElement);
  return (event) => {
    event.preventDefault();
    if (opener instanceof HTMLElement) opener.focus();
  };
}
