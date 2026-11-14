// Plays the list's motion (list/motion-plan.ts) on the placed items with the Web Animations API. Each
// item's wrapper owns its translateY(y); a move is added on top of it (`composite: "add"`), so a row can
// glide in the order and slide for the room around it at once, and a move cut short by the
// next one carries on from where it was seen. With Reduce motion nothing moves, and turning it on
// stops what does. What is under way, and so what stays mounted, is ./flight.ts.
import { useLayoutEffect, useRef, useState } from "react";
import type { Layout } from "../../list/layout.ts";
import { STILL, type Ghost, type MotionPlan, type Timing } from "../../list/motion-plan.ts";
import { atRest, landed, passing, settled, takeOff, type View } from "./flight.ts";
import { Playing } from "./playing.ts";
import { useReducedMotion } from "./reduced-motion.ts";

export type LayoutMotion = {
  /** Keys of items on their way across the view: mounted beside those standing in it. */
  passing: readonly string[];
  /** Items gone from the view's sections, drawn where they stood until they have closed. */
  ghosts: readonly Ghost[];
  /** Registers a ghost's node, so its closing can play. */
  ghostRef(key: string): (node: HTMLElement | null) => void;
};

/** `nodes`: the placed items' wrappers by key. `view`: the scroller's window as last scrolled. */
export function useLayoutMotion(layout: Layout, nodes: ReadonlyMap<string, HTMLElement>, view: View): LayoutMotion {
  const reduced = useReducedMotion();
  const ghostNodes = useRef(new Map<string, HTMLElement>()).current;
  const [playing] = useState(() => new Playing());
  const [flight, setFlight] = useState(() => atRest(layout));
  // why: React's "adjust state when a prop changes": the plan is known in the render that shows the new
  // layout, so what is about to move, and each ghost, is mounted for the first frame of its move.
  const current = reduced ? settled(flight, layout) : flight.layout === layout ? flight : takeOff(flight, layout, view);
  if (current !== flight) setFlight(current);

  const { plan, drop } = current;
  useLayoutEffect(() => {
    if (plan === STILL) return;
    const running = [...play(plan, nodes, ghostNodes), ...followDrop(drop, plan, [...nodes.values(), ...ghostNodes.values()])];
    playing.hold(running, () => setFlight((f) => landed(f, plan)));
  }, [plan, drop, nodes, ghostNodes, playing]);

  // why: Reduce motion turning on stops what is already under way (the flight settled above, in the same
  // render), and nothing the list started outlives it, nor lands on it once it is gone.
  useLayoutEffect(() => {
    if (reduced) playing.stop();
  }, [reduced, playing]);
  useLayoutEffect(() => () => playing.tearDown(), [playing]);

  return {
    passing: passing(current, view),
    ghosts: current.ghosts,
    ghostRef: (key) => (node) => {
      if (node) ghostNodes.set(key, node);
      else ghostNodes.delete(key);
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** Starts every animation the plan holds on the nodes mounted for it; an item out of view has none. */
function play(plan: MotionPlan, nodes: ReadonlyMap<string, HTMLElement>, ghostNodes: ReadonlyMap<string, HTMLElement>): Animation[] {
  const running: Animation[] = [];
  const on = (node: HTMLElement | undefined, frames: Keyframe[], timing: Timing, options: KeyframeAnimationOptions) => {
    if (node !== undefined) running.push(node.animate(frames, { duration: timing.ms, delay: timing.delay, easing: timing.easing, ...options }));
  };
  for (const move of plan.moves) {
    for (const s of move.segments) {
      on(nodes.get(move.key), [{ transform: `translateY(${s.from}px)` }, { transform: "translateY(0)" }], s.timing, { composite: "add", fill: "backwards" });
    }
  }
  for (const a of plan.arrivals) {
    const [opens, open] = a.window;
    // why: keyframe offsets under the timing's easing: the clip's edge crosses this item when the fold's does.
    const reveal = [
      { offset: 0, clipPath: SHUT },
      { offset: opens, clipPath: SHUT },
      { offset: open, clipPath: OPEN },
      { offset: 1, clipPath: OPEN },
    ];
    on(nodes.get(a.key), reveal, a.reveal, { fill: "backwards" });
    on(nodes.get(a.key), [{ opacity: 0 }, { opacity: 1 }], a.fade, { fill: "backwards" });
  }
  for (const g of plan.ghosts) {
    const node = ghostNodes.get(g.entry.key);
    on(node, [{ opacity: 1 }, { opacity: 0 }], g.fade, { fill: "both" });
    on(node, [{ clipPath: OPEN }, { clipPath: SHUT }], g.collapse, { fill: "both" });
  }
  return running;
}

/**
 * The content closing up under a view scrolled to its end drops the scroll at once; the view comes down
 * with the room as it closes instead, as the prototype's shrinking fold pulls it: every item
 * starts `drop` higher, where it was seen, and settles on the leavers' closing.
 */
function followDrop(drop: number, plan: MotionPlan, items: readonly HTMLElement[]): Animation[] {
  const closing = plan.ghosts[0]?.collapse;
  if (drop < 0.5 || closing === undefined) return [];
  const timing = { duration: closing.ms, delay: closing.delay, easing: closing.easing };
  return items.map((node) => node.animate([{ transform: `translateY(${-drop}px)` }, { transform: "translateY(0)" }], { ...timing, composite: "add", fill: "backwards" }));
}

/** Clipped to nothing from the bottom up; whole. */
const SHUT = "inset(0 0 100% 0)";
const OPEN = "inset(0 0 0 0)";
