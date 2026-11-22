import { parseJson } from "../../model/json.ts";
import { layoutSchema, type Layout } from "../../model/layout.ts";
import { z } from "zod";

const KEY = "bb.splitLayout";
const storedSchema = z.strictObject({ version: z.literal(1), layout: layoutSchema });

/** The layout bb stored for this window; null before bb's first layout, or in a format this plugin can't read. */
export function readStored(): Layout | null {
  const stored = sessionStorage.getItem(KEY);
  if (stored === null) return null;
  const parsed = storedSchema.safeParse(parseJson(stored));
  return parsed.success ? parsed.data.layout : null;
}
