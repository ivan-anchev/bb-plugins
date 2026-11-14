// What of the list's motion is under way, as data: every plan's moves until that plan lands, and the
// leavers still closing, so what must stay mounted for them is known in the render that needs it. Pure;
// use-layout-motion.ts plays the plans.
import { OVERSCAN, type Layout } from "../../list/layout.ts";
import { planMotion, STILL, type Ghost, type Move, type MotionPlan } from "../../list/motion-plan.ts";

/** The scroller's window as last scrolled. */
export type View = { top: number; height: number };

export type Flight = {
  /** The layout last planned from. */
  layout: Layout;
  /** The latest plan, to be played. */
  plan: MotionPlan;
  /** How far the browser drops the scroll as the plan lands: the content closing up under a view scrolled to its end. */
  drop: number;
  /** Every move not yet landed. A plan cut short by the next one plays on, so an item can have several. */
  moving: readonly Move[];
  /** Leavers still closing: those the view could show while their plan plays, chosen when it starts. */
  ghosts: readonly Ghost[];
};

/** Nothing under way: the layout as it stands. */
export function atRest(layout: Layout): Flight {
  return { layout, plan: STILL, drop: 0, moving: [], ghosts: [] };
}

/**
 * The list now shows `layout`: its plan joins what is still under way. An item gone from the list takes
 * its moves with it, and a ghost whose item came back goes: the item stands there again.
 */
export function takeOff(flight: Flight, layout: Layout, view: View): Flight {
  const keys = new Set(layout.entries.map((e) => e.key));
  const plan = planMotion(flight.layout, layout);
  const drop = Math.max(0, view.top + view.height - layout.height);
  // why: a ghost mounted later would have missed its closing and stand there whole; one the view can show
  // is mounted now. The drop carries everything down by `drop` as it lands, so a ghost above the view can
  // come into it.
  const seen = plan.ghosts.filter((g) => crosses(g.entry.y, g.entry.y + g.entry.h + drop, view));
  return {
    layout,
    plan,
    drop,
    moving: [...flight.moving.filter((m) => keys.has(m.key)), ...plan.moves],
    ghosts: [...flight.ghosts.filter((g) => !keys.has(g.entry.key)), ...seen],
  };
}

/** `plan` played out: its moves and its ghosts are done. Later plans' carry on. */
export function landed(flight: Flight, plan: MotionPlan): Flight {
  const done = new Set<Move | Ghost>([...plan.moves, ...plan.ghosts]);
  return { ...flight, moving: flight.moving.filter((m) => !done.has(m)), ghosts: flight.ghosts.filter((g) => !done.has(g)) };
}

/** With Reduce motion nothing is under way, even what was when it turned on. `flight` itself when it already stands at `layout`. */
export function settled(flight: Flight, layout: Layout): Flight {
  const resting = flight.layout === layout && flight.plan === STILL && flight.moving.length === 0 && flight.ghosts.length === 0;
  return resting ? flight : atRest(layout);
}

/**
 * Keys of the moving items the view could show anywhere their unfinished moves can carry them: mounted
 * until they land, beside those standing in view.
 */
export function passing(flight: Flight, view: View): string[] {
  const reach = reachOf(flight.moving);
  return flight.layout.entries
    .filter((e) => {
      const r = reach.get(e.key);
      return r !== undefined && crosses(e.y + r.up, e.y + e.h + r.down, view);
    })
    .map((e) => e.key);
}

// ------------------------------------------------------------------ layer 2

/**
 * How far above (`up`, negative) and below (`down`) its place each moving item can be drawn. Every
 * segment eases from its `from` to none without overshooting (EASE and out(3) stay within 0…1), and
 * they add, whichever plan started them and however far each has run.
 */
function reachOf(moving: readonly Move[]): Map<string, { up: number; down: number }> {
  const reach = new Map<string, { up: number; down: number }>();
  for (const { key, segments } of moving) {
    const r = reach.get(key) ?? { up: 0, down: 0 };
    for (const s of segments) {
      r.up += Math.min(s.from, 0);
      r.down += Math.max(s.from, 0);
    }
    reach.set(key, r);
  }
  return reach;
}

/** Whether the strip `top`…`bottom` meets the view, give or take the overscan the list mounts. */
function crosses(top: number, bottom: number, view: View): boolean {
  return bottom > view.top - OVERSCAN && top < view.top + view.height + OVERSCAN;
}
