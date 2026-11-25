// Plays the Managers view's pin motion (pin-motion.ts) with the Web Animations API, on transform and
// opacity, on the list's own ease-out. Where each item stood is read after every commit and when the
// view resizes, from layout alone (no transform counts), so the next change knows where it started. A
// slide adds onto one still under way (`composite: "add"`), so an item cut short carries on from where
// it was seen. With Reduce motion everything takes its place at once.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { glideMs, OUT3 } from "../../../list/motion-plan.ts";
import { useReducedMotion } from "../../motion/reduced-motion.ts";
import { planPinMotion, type Box, type PinMove, type Placed } from "./pin-motion.ts";

/** `scroller`: the view, holding each item in a `[data-key]` wrapper, the grid's in `.as-pins`. */
export function usePinMotion(scroller: RefObject<HTMLElement | null>): void {
  const reduced = useReducedMotion();
  const last = useRef<ReadonlyMap<string, Placed>>(new Map());

  // why no deps: any commit can move an item, so each one reads where they now stand.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const now = placed(el);
    if (!reduced) for (const move of planPinMotion(last.current, now)) play(move, el);
    last.current = now;
  });

  // why: a resize reflows the grid without a commit; the next pin starts from where things stand after it.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => {
      last.current = placed(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroller]);
}

// ------------------------------------------------------------------ layer 2

/** Every item where layout puts it in the scroller's content; none while the view is hidden. */
function placed(scroller: HTMLElement): Map<string, Placed> {
  return new Map(
    Array.from(scroller.querySelectorAll<HTMLElement>("[data-key]")).flatMap((item): [string, Placed][] => {
      const key = item.dataset.key;
      const face = item.querySelector<HTMLElement>(".as-avatar");
      if (key === undefined || face === null || item.offsetParent === null) return [];
      return [[key, { where: item.closest(".as-pins") === null ? "list" : "grid", box: boxIn(item, scroller), face: boxIn(face, scroller) }]];
    }),
  );
}

/** `el`'s layout box relative to `scroller`'s content, transforms aside. */
function boxIn(el: HTMLElement, scroller: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let at: Element | null = el; at instanceof HTMLElement && at !== scroller; at = at.offsetParent) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function play(move: PinMove, scroller: HTMLElement) {
  const item = scroller.querySelector<HTMLElement>(`[data-key="${CSS.escape(move.key)}"]`);
  if (item === null) return;
  switch (move.kind) {
    case "slide": {
      const timing = { duration: glideMs(Math.hypot(move.dx, move.dy)), easing: OUT3, composite: "add" as const };
      item.animate([{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: "translate(0, 0)" }], timing);
      return;
    }
    case "fly": {
      const duration = glideMs(Math.hypot(move.dx, move.dy));
      const face = item.querySelector<HTMLElement>(".as-avatar");
      // why: from its top-left corner, where the move is measured.
      const from = { transform: `translate(${move.dx}px, ${move.dy}px) scale(${move.scale})`, transformOrigin: "0 0" };
      face?.animate([from, { transform: "none", transformOrigin: "0 0" }], { duration, easing: OUT3 });
      // why: its words come in after the avatar has left, so they don't read as sliding with it.
      for (const words of item.querySelectorAll<HTMLElement>(".as-pin-name, .as-manager-words")) {
        words.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration, easing: OUT3 });
      }
      return;
    }
    case "arrive":
      item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: glideMs(0), easing: OUT3 });
      return;
    default:
      move satisfies never;
  }
}
