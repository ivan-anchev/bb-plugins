// An issue gone to on the board, brought to the top of the page it scrolls in, smoothly unless Reduce
// motion is on, and kept there as what opens under it draws. why kept: its detail reads the issue
// after the row lands, so at first the page may not reach far enough to bring the row up, and the
// detail would draw below the fold. It lets go at the user's first move, or once focus leaves the row.
import { reducedMotion } from "./reduced-motion.ts";

/** What ends the reveal: the user scrolling, pressing or typing anywhere. */
const USER_MOVES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export function revealAtTop(row: HTMLElement): void {
  const reveal = () => row.scrollIntoView({ block: "start", behavior: reducedMotion() ? "instant" : "smooth" });
  const item = row.closest("li");
  // why throw: every row is drawn in its list item, with its detail.
  if (item === null) throw new Error(`A board row outside a list item: ${row.getAttribute("aria-label")}`);
  const drawing = new ResizeObserver(reveal);
  const stop = () => {
    drawing.disconnect();
    for (const type of USER_MOVES) document.removeEventListener(type, stop, true);
    row.removeEventListener("blur", stop);
  };
  reveal();
  drawing.observe(item);
  for (const type of USER_MOVES) document.addEventListener(type, stop, true);
  row.addEventListener("blur", stop);
}
