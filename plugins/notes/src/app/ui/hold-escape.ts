// While held, Esc never leaves the page under the plugin, wherever focus is. bb's own Esc leaves the
// page; it skips an event whose default was prevented. Adapted from pr-reviews
// (src/app/ui/hold-escape.ts): every plugin installs standalone. The React binding is
// use-hold-escape.ts.

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
