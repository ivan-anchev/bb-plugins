const HUES = ["violet", "blue", "emerald", "sky", "amber", "rose", "lime", "teal", "orange", "indigo", "pink", "cyan"] as const;

type Hue = (typeof HUES)[number];

const utf8 = new TextEncoder();

/** Over the key's UTF-8 bytes, as Lua's `string.byte` walks it, so any id hashes as in Zeron. The key is the project id. */
export function hueOf(key: string): Hue {
  let n = 0;
  for (const byte of utf8.encode(key)) n = (n * 31 + byte) % 9973;
  return HUES[n % HUES.length];
}
