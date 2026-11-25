// Zeron's 12 identity hues: a project's tile hue, Zeron's hash of the project's key, and a regional
// manager's avatar colour. bb's project has no repository identity, so the key is the project id, Zeron's own fallback.

// Zeron's order (DEFAULT_HUES), kept so a project's hue never changes.
export const HUES = ["violet", "blue", "emerald", "sky", "amber", "rose", "lime", "teal", "orange", "indigo", "pink", "cyan"] as const;

export type Hue = (typeof HUES)[number];

/** Each hue's 500, which a tile and an avatar are filled with, and its 50, which a tile's initial is inked in (Zeron's palette). */
export const HUE_COLORS: Record<Hue, { fill: `#${string}`; ink: `#${string}` }> = {
  violet: { fill: "#9579ee", ink: "#f7f6fe" },
  blue: { fill: "#4b8ff3", ink: "#f2f7fe" },
  emerald: { fill: "#27ac7a", ink: "#effaf4" },
  sky: { fill: "#149dd2", ink: "#eff9fe" },
  amber: { fill: "#d68d0a", ink: "#fef6ec" },
  rose: { fill: "#e25e76", ink: "#fef4f5" },
  lime: { fill: "#86b241", ink: "#f4f9ef" },
  teal: { fill: "#18aa99", ink: "#effaf7" },
  orange: { fill: "#e07434", ink: "#fef5f0" },
  indigo: { fill: "#7584f4", ink: "#f4f6fe" },
  pink: { fill: "#d6629e", ink: "#fff3f8" },
  cyan: { fill: "#09a6b7", ink: "#eff9fb" },
};

const utf8 = new TextEncoder();

/** Over the key's UTF-8 bytes, as Lua's `string.byte` walks it, so any id hashes as in Zeron. */
export function hueOf(key: string): Hue {
  let n = 0;
  for (const byte of utf8.encode(key)) n = (n * 31 + byte) % 9973;
  return HUES[n % HUES.length];
}
