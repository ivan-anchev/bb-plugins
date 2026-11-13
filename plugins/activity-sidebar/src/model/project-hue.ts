// A project's tile hue: Zeron's hash of the project's key (screens/shell/project_default.luau
// hue_of). bb's project has no repository identity, so the key is the project id, Zeron's own
// fallback. The tile colours live in app.css as `.as-tile[data-hue]`.

// Zeron's order (DEFAULT_HUES), kept so a project's hue never changes.
const HUES = ["violet", "blue", "emerald", "sky", "amber", "rose", "lime", "teal", "orange", "indigo", "pink", "cyan"] as const;

export type Hue = (typeof HUES)[number];

const utf8 = new TextEncoder();

/** Over the key's UTF-8 bytes, as Lua's `string.byte` walks it, so any id hashes as in Zeron. */
export function hueOf(key: string): Hue {
  let n = 0;
  for (const byte of utf8.encode(key)) n = (n * 31 + byte) % 9973;
  return HUES[n % HUES.length];
}
