// why: the SDK reads bb's split layout only as flat pane rects (useSidebarSplitLayout), with no tree, sizes
// or pane contents. bb persists the whole tree under this sessionStorage key on every change, in the
// format layoutSchema copies, so the plugin reads it there.
import type { HostLayout } from "../controller/tabs-controller.ts";
import { layoutSchema } from "../model/layout.ts";
import { z } from "zod";

const KEY = "bb.splitLayout";
const storedSchema = z.strictObject({ version: z.literal(1), layout: layoutSchema });

export const hostLayout: HostLayout = {
  read() {
    // Missing before bb's first layout; bb writes an empty string when it clears its layout.
    const stored = sessionStorage.getItem(KEY);
    if (stored === null) return null;
    const parsed = storedSchema.safeParse(decode(stored));
    return parsed.success ? parsed.data.layout : null;
  },
};

/** The stored JSON, or undefined (which the schema rejects) when it is empty or malformed. */
function decode(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}
