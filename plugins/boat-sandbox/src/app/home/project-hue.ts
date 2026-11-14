// A project's tile hue, copied from activity-sidebar (src/model/project-hue.ts) so a project wears the same
// colour in both; plugins install standalone, so it is a copy, not an import. The tile colours live in
// spend-card.css as `.bs-tile[data-hue]`.

// Zeron's order (DEFAULT_HUES), kept so a project's hue never changes.
const HUES = ["violet", "blue", "emerald", "sky", "amber", "rose", "lime", "teal", "orange", "indigo", "pink", "cyan"] as const;

type Hue = (typeof HUES)[number];

const utf8 = new TextEncoder();

/** Over the key's UTF-8 bytes, as Lua's `string.byte` walks it, so any id hashes as in Zeron. The key is the project id. */
export function hueOf(key: string): Hue {
  let n = 0;
  for (const byte of utf8.encode(key)) n = (n * 31 + byte) % 9973;
  return HUES[n % HUES.length];
}
