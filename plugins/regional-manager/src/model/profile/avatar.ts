// What a regional manager is pictured by: a still blob, drawn by blob-avatar, of one of its 21 shapes
// in one of Zeron's 12 identity hues, with a friendly face. A look is chosen once and stored, never
// derived from the name, so a rename never changes it; two managers share one only by the user's pick.
import type { Expression, Shape } from "blob-avatar";
import { z } from "zod";

/** Every shape blob-avatar draws, in its order, which the picker shows. */
export const SHAPES = ["circle", "pebble", "squircle", "capsule", "triangle", "diamond", "hexagon", "star", "cloud", "droplet", "heart", "ghost", "cat", "bear", "bunny", "amoeba", "flower", "clover", "leaf", "gem", "bubble"] as const satisfies readonly Shape[];
// why: a shape a later blob-avatar adds fails to compile here until the list has it, so the picker never silently lacks one.
type Unlisted = Exclude<Shape, (typeof SHAPES)[number]>;
const everyShapeListed: [Unlisted] extends [never] ? true : Unlisted = true;

/** Zeron's identity hues (DEFAULT_HUES), in Zeron's order, which the picker shows. */
export const HUE_NAMES = ["violet", "blue", "emerald", "sky", "amber", "rose", "lime", "teal", "orange", "indigo", "pink", "cyan"] as const;

/**
 * Each identity hue's colour: the one the Activity Sidebar paints its project tiles with (its app.css
 * `.as-tile[data-hue]`), copied, as a plugin imports nothing from another. The same in light and
 * dark, as the project tiles are, and every one gets white eyes.
 */
export const HUES: Record<(typeof HUE_NAMES)[number], `#${string}`> = {
  violet: "#9579ee",
  blue: "#4b8ff3",
  emerald: "#27ac7a",
  sky: "#149dd2",
  amber: "#d68d0a",
  rose: "#e25e76",
  lime: "#86b241",
  teal: "#18aa99",
  orange: "#e07434",
  indigo: "#7584f4",
  pink: "#d6629e",
  cyan: "#09a6b7",
};

/** The faces a manager can wear: the friendly ones of blob-avatar's 26. */
const EXPRESSIONS = ["neutral", "happy", "content", "curious", "attentive", "determined"] as const satisfies readonly Expression[];

export const avatarSchema = z.object({ kind: z.literal("blob"), shape: z.enum(SHAPES), hue: z.enum(HUE_NAMES), expression: z.enum(EXPRESSIONS) });
export type Avatar = z.infer<typeof avatarSchema>;

/** How many looks tell managers apart: a shape in a hue. The face barely reads at 20 px, so it never counts. */
const LOOKS = SHAPES.length * HUE_NAMES.length;

/** How many starts `freeLook` tells apart: every look with every face. */
const STARTS = LOOKS * EXPRESSIONS.length;

/** A start for a new or shuffled look: any of the looks, with any face. */
export const randomStart = (): number => Math.floor(Math.random() * STARTS);

/**
 * The first look from `start` on that none of `taken` has, its face picked by `start` too; once all
 * 252 are taken, the one at `start`. `start` is any whole number ≥ 0: a random one, or an id's seed.
 */
export function freeLook(start: number, taken: readonly Avatar[]): Avatar {
  const used = new Set(taken.map(lookKey));
  const expression = EXPRESSIONS[Math.floor(start / LOOKS) % EXPRESSIONS.length];
  for (let step = 0; step < LOOKS; step++) {
    const look = lookAt((start + step) % LOOKS, expression);
    if (!used.has(lookKey(look))) return look;
  }
  return lookAt(start % LOOKS, expression);
}

/** A start taken from an id, the same on every run: FNV-1a over its UTF-8 bytes. */
export function seedOf(id: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

const lookAt = (slot: number, expression: Avatar["expression"]): Avatar => ({ kind: "blob", shape: SHAPES[slot % SHAPES.length], hue: HUE_NAMES[Math.floor(slot / SHAPES.length)], expression });

const lookKey = ({ shape, hue }: Avatar): string => `${shape}/${hue}`;
