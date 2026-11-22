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
  const current = reduced ? settled(flight, layout) : flight.layout === layout ? flight : takeOff(flight, layout, view);
  if (current !== flight) setFlight(current);

  const { plan, drop } = current;
  useLayoutEffect(() => {
    if (plan === STILL) return;
    const running = [...play(plan, nodes, ghostNodes), ...followDrop(drop, plan, [...nodes.values(), ...ghostNodes.values()])];
    playing.hold(running, () => setFlight((f) => landed(f, plan)));
  }, [plan, drop, nodes, ghostNodes, playing]);

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

function followDrop(drop: number, plan: MotionPlan, items: readonly HTMLElement[]): Animation[] {
  const closing = plan.ghosts[0]?.collapse;
  if (drop < 0.5 || closing === undefined) return [];
  const timing = { duration: closing.ms, delay: closing.delay, easing: closing.easing };
  return items.map((node) => node.animate([{ transform: `translateY(${-drop}px)` }, { transform: "translateY(0)" }], { ...timing, composite: "add", fill: "backwards" }));
}

const SHUT = "inset(0 0 100% 0)";
const OPEN = "inset(0 0 0 0)";
