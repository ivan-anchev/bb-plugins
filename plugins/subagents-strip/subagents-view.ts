// The Subagents tab's UI state and how a click or a landing changes it: which
// batches the user opened or closed, the one expanded row, and the landing
// last shown. Pure, so every change is tested; ui/SubagentsTab.tsx keeps it
// per thread and renders it.
import type { DelegateId } from "./delegate.ts";
import type { Batch } from "./roster.ts";
import type { Landing } from "./subagents-tab.ts";

/** A batch the user opened (true) or closed (false), by its id; absent, it follows Batch.opensByDefault. */
type BatchToggles = ReadonlyMap<string | null, boolean>;

export type View = { toggled: BatchToggles; expanded: DelegateId | null; landed: Landing | null };

export const EMPTY_VIEW: View = { toggled: new Map(), expanded: null, landed: null };

export function isOpen(view: View, batch: Batch): boolean {
  return view.toggled.get(batch.id) ?? batch.opensByDefault;
}

/** The view with the landing's row expanded and its batch open, whatever the user last did with that batch. */
export function landOn(view: View, landing: Landing, batches: readonly Batch[]): View {
  const home = batches.find((batch) => batch.delegates.some((d) => d.id === landing.delegateId));
  const toggled = home ? new Map(view.toggled).set(home.id, true) : view.toggled;
  return { toggled: present(toggled, batches), expanded: landing.delegateId, landed: landing };
}

/** A batch opened or closed; closing it closes the row expanded in it, which it hides. */
export function toggleBatch(view: View, batch: Batch, batches: readonly Batch[]): View {
  const closing = isOpen(view, batch);
  const toggled = new Map(view.toggled).set(batch.id, !closing);
  const expanded = closing && batch.delegates.some((d) => d.id === view.expanded) ? null : view.expanded;
  return { ...view, toggled: present(toggled, batches), expanded };
}

/** A row expanded, or collapsed when it was; one is expanded at a time. */
export function toggleRow(view: View, id: DelegateId, batches: readonly Batch[]): View {
  return { ...view, toggled: present(view.toggled, batches), expanded: view.expanded === id ? null : id };
}

// ---------------------------------------------------------------- layer 2

/** The toggles of batches that still exist: a rewrite can drop a prompt, and its toggle with it. */
function present(toggled: BatchToggles, batches: readonly Batch[]): BatchToggles {
  const ids = new Set(batches.map((batch) => batch.id));
  return new Map([...toggled].filter(([id]) => ids.has(id)));
}
