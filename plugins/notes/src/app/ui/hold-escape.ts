/**
 * Stops every Esc that reaches `target` from reaching bb, until released. An Esc something on the
 * page already took (a dialog's dismiss, a picker's close) is left alone; any other goes to `onEscape`.
 */
export function holdEscape(target: EventTarget, onEscape: () => void): () => void {
  const listener = (event: Event) => {
    if (!("key" in event) || event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onEscape();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
