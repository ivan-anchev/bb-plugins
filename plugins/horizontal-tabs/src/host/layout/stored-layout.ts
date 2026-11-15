// why sessionStorage: until bb's layout atom is located, and whenever it can't be, bb's own copy of its tree
// is the one place to read it. bb persists it under this key on every change, in the format layoutSchema
// copies.
import { parseJson } from "../../model/json.ts";
import { layoutSchema, type Layout } from "../../model/layout.ts";
import { z } from "zod";

const KEY = "bb.splitLayout";
const storedSchema = z.strictObject({ version: z.literal(1), layout: layoutSchema });

/** The layout bb stored for this window; null before bb's first layout, or in a format this plugin can't read. */
export function readStored(): Layout | null {
  // Missing before bb's first layout; bb writes an empty string when it clears its layout.
  const stored = sessionStorage.getItem(KEY);
  if (stored === null) return null;
  const parsed = storedSchema.safeParse(parseJson(stored));
  return parsed.success ? parsed.data.layout : null;
}
