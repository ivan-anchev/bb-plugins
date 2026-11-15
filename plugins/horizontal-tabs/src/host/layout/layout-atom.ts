// why: the SDK cannot set a whole split layout. bb keeps it in one jotai atom in jotai's default store, and
// both the store getter and the atom are ES-module exports of chunks bb has already loaded; importing a
// chunk's URL again returns bb's live module, so one store.set shows any layout with exact sizes in one
// frame (layout-restore probe L5). Everything bundle-specific lives here and is found by shape, never by
// minified name: zero or several candidates reject, and the caller reports the reason.
// Adapted from prototypes/layout-restore/lr-probe/src/split-layout-host.ts (locateHost).
import { layoutSchema, type Layout } from "../../model/layout.ts";

type LayoutAtom = {
  /** The layout bb holds; null when it holds none, or holds one this plugin can't parse (a newer bb). */
  read(): Layout | null;
  /** bb shows `layout`, and saves it where bb saves its own (sessionStorage and localStorage). */
  write(layout: Layout): void;
};

type Atom = { read: (...args: never[]) => unknown; write: (...args: never[]) => unknown };
type Store = { get(atom: Atom): unknown; set(atom: Atom, value: unknown): void };
type Module = Record<string, unknown>;

const STORAGE_KEY = "bb.splitLayout";
// jotai's getDefaultStore, minified: `function x(){return s||=f(),s}`.
const STORE_GETTER = /^function [\w$]+\(\)\{return ([\w$]+)\|\|=[\w$]+\(\),\1\}$/;

let located: Promise<LayoutAtom> | null = null;
let current: LayoutAtom | null = null;

/**
 * bb's layout atom, found once. A failure is not kept, so the next call retries: a fresh window on the New
 * thread screen has no layout yet to tell the atom by.
 */
export function locateLayoutAtom(): Promise<LayoutAtom> {
  located ??= find().then(
    (atom) => (current = atom),
    (error: unknown) => {
      located = null;
      throw error;
    },
  );
  return located;
}

/** bb's layout atom if it was located already, else null; never waits. */
export function currentLayoutAtom(): LayoutAtom | null {
  return current;
}

async function find(): Promise<LayoutAtom> {
  const vendor: Module = await import(/* @vite-ignore */ chunkUrl("boot-vendor"));
  const index: Module = await import(/* @vite-ignore */ chunkUrl("index"));
  const getDefaultStore = onlyOne(Object.values(vendor).filter(isStoreGetter), "store getter");
  const store = getDefaultStore();
  if (!isStore(store)) throw new Error("bb's store getter returned no store");
  const stored = storedLayoutJson();
  const atom = onlyOne(
    Object.values(index).filter((value): value is Atom => isWritableAtom(value) && holds(store, value, stored)),
    "layout atom",
  );
  return {
    read() {
      const parsed = layoutSchema.safeParse(store.get(atom));
      return parsed.success ? parsed.data : null;
    },
    write(layout) {
      store.set(atom, structuredClone(layout));
    },
  };
}

/** The URL bb loaded its `<name>-<hash>.js` chunk from. */
function chunkUrl(name: string): string {
  const pattern = new RegExp(`/assets/${name}-[^/]+\\.js$`);
  const url = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .concat(Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"), (script) => script.src))
    .find((candidate) => pattern.test(new URL(candidate).pathname));
  if (url === undefined) throw new Error(`bb's ${name} chunk is not loaded`);
  return url;
}

/** bb's stored layout as JSON, to tell its atom by. */
function storedLayoutJson(): string {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  const layout: unknown = stored ? JSON.parse(stored).layout : null;
  if (layout === null || layout === undefined) throw new Error("bb holds no layout to find its atom by yet");
  return JSON.stringify(layout);
}

/** Whether `atom` holds the layout bb stored. Reading some other atom may throw; it is not the one. */
function holds(store: Store, atom: Atom, stored: string): boolean {
  try {
    return JSON.stringify(store.get(atom)) === stored;
  } catch {
    return false;
  }
}

function isStoreGetter(value: unknown): value is () => unknown {
  return typeof value === "function" && value.length === 0 && STORE_GETTER.test(String(value));
}

function isStore(value: unknown): value is Store {
  return typeof value === "object" && value !== null && "get" in value && "set" in value && typeof value.get === "function" && typeof value.set === "function";
}

function isWritableAtom(value: unknown): value is Atom {
  return typeof value === "object" && value !== null && "read" in value && "write" in value && typeof value.read === "function" && typeof value.write === "function";
}

function onlyOne<T>(candidates: T[], what: string): T {
  if (candidates.length !== 1) throw new Error(`bb's ${what}: ${candidates.length} candidates`);
  return candidates[0];
}
