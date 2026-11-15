// This window's tabs, kept across reloads the way bb keeps its split layout: sessionStorage holds the
// window's own copy, and localStorage the last copy any window saved, which seeds a fresh window. Each
// window then goes its own way; nothing listens for another window's saves.
import { z } from "zod";
import { parseJson } from "./json.ts";
import { layoutSchema } from "./layout.ts";
import type { Tab, TabSet } from "./tab-set.ts";

/** Where the controller loads its tabs from and saves them to. */
export type SavedTabs = {
  /** The window's own tabs, else the device's last saved ones; null when neither has a tab this plugin reads. */
  load(): TabSet | null;
  save(set: TabSet): void;
};

const VERSION = 1;
const tabSchema: z.ZodType<Tab> = z.object({ id: z.string().min(1), layout: layoutSchema });
// why `unknown` tabs: each is parsed on its own, so a tab this plugin can't read costs only itself.
const envelopeSchema = z.object({ version: z.literal(VERSION), tabs: z.array(z.unknown()), liveId: z.string() });

/** The tabs saved under `pluginId` (experimental_usePluginId), so a renamed copy of the plugin keeps its own. */
export function savedTabs(pluginId: string): SavedTabs {
  const key = `${pluginId}:tabs`;
  /** What this window wrote last, so a change that leaves the tabs as they were writes nothing. */
  let written: string | null = null;
  return {
    load() {
      for (const area of [sessionStorage, localStorage]) {
        const set = parse(area.getItem(key));
        if (set !== null) return set;
      }
      return null;
    },

    save(set) {
      const saved = JSON.stringify({ version: VERSION, tabs: set.tabs, liveId: set.liveId });
      if (saved === written) return;
      try {
        sessionStorage.setItem(key, saved);
        localStorage.setItem(key, saved);
        written = saved;
      } catch (error) {
        // why: a write that fails part way can leave this save in one copy and the last in the other, so the next save writes.
        written = null;
        // why: a full storage must not take the strip down; the tabs still work until the window reloads.
        console.warn("[horizontal-tabs] could not save the tabs:", error);
      }
    },
  };
}

function parse(stored: string | null): TabSet | null {
  if (stored === null) return null;
  const envelope = envelopeSchema.safeParse(parseJson(stored));
  if (!envelope.success) return null;
  const tabs = readableTabs(envelope.data.tabs);
  if (tabs.length === 0) return null;
  const { liveId } = envelope.data;
  return { tabs, liveId: tabs.some((tab) => tab.id === liveId) ? liveId : tabs[0].id };
}

/** The stored tabs this plugin can read, keeping only the first under each id, as a set names each tab once. */
function readableTabs(stored: readonly unknown[]): Tab[] {
  const ids = new Set<string>();
  return stored.flatMap((tab) => {
    const parsed = tabSchema.safeParse(tab);
    if (!parsed.success || ids.has(parsed.data.id)) return [];
    ids.add(parsed.data.id);
    return [parsed.data];
  });
}
