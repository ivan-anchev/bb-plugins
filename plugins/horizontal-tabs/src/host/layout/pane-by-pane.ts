// why: the fallback for when bb's layout atom can't be located (a bb update renamed its chunks, moved the
// atom or changed its schema). It shows a tab through the SDK's per-window navigation alone, plus bb's own
// Close pane buttons, as the SDK has no way to close a pane (feasibility P3); the SDK's thread opener and
// pane actions broadcast to every window, so neither is used. bb opens each split as an equal one right of the
// focused pane, so the tab's threads come back in order, focused as they were, side by side at equal sizes.
// why every thread opens as a split: bb applies a split to its layout as it is called, focusing the thread's
// pane when one shows it, so splits need no wait between them. A plain open only changes the route, and bb
// follows from an effect on the route it has committed, which lags quick navigations: when it already reads
// the thread, bb moves nothing. Opening the first thread and closing panes do wait until bb shows them.
import type { Nav } from "../../controller/tabs-controller.ts";
import { focused, panes, type Layout } from "../../model/layout.ts";
import { PANE, paneIdsOnScreen } from "../screen.ts";
import { readStored } from "./stored-layout.ts";
import { untilFrame } from "./until-frame.ts";

const STEP_TIMEOUT_MS = 1000;
const CLOSE_PANE = 'header button[aria-label="Close pane"]';

/**
 * bb shows `layout`'s threads in pane order, side by side in equal splits, with its focused thread focused.
 * A `+` tab's New thread screen comes back as it was; New thread and plugin panes beside threads are left
 * out, as the SDK can open neither in a split. Rejects when bb does not show a step within a second, and with
 * the signal's reason once it aborts, after which bb is not navigated.
 */
export async function rebuildPaneByPane(layout: Layout, nav: Nav, signal: AbortSignal): Promise<void> {
  const threads = [...new Set(threadsOf(layout))];
  const [first, ...rest] = threads;
  // From Settings too, this brings bb's panes back on screen, to be closed.
  if (first === undefined) {
    await step(() => nav.toCompose(), (bb) => focused(bb).content.kind === "new-thread", "show its New thread screen", signal);
    return closeUnfocusedPanes(signal);
  }
  await step(() => nav.toThread(first, { split: true }), (bb) => focusedThread(bb) === first, `show thread ${first}`, signal);
  await closeUnfocusedPanes(signal);
  // bb focuses the pane it opens last, and opening a thread bb shows focuses its pane.
  const target = focused(layout).content;
  const focus = target.kind === "thread" ? target.threadId : threads[threads.length - 1];
  await step(
    () => [...rest, focus].forEach((threadId) => nav.toThread(threadId, { split: true })),
    (bb) => {
      const shown = threadsOf(bb);
      return focusedThread(bb) === focus && shown.length === threads.length && shown.every((id, i) => id === threads[i]);
    },
    "show the tab's threads",
    signal,
  );
}

/** Navigates, then waits until bb's layout passes `shown`, with its focused pane on screen. */
async function step(navigate: () => void, shown: (bb: Layout) => boolean, what: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  navigate();
  const done = () => {
    const bb = readStored();
    return bb !== null && shown(bb) && paneIdsOnScreen().has(bb.focusedPaneId);
  };
  await untilFrame(done, what, STEP_TIMEOUT_MS, signal);
}

/**
 * Closes every pane but the focused one, one at a time.
 * why bb's stored focus: the panes' own focus marker lags it, so right after a step moves focus it still
 * marks the pane focus left, and the newly focused pane would be closed.
 */
async function closeUnfocusedPanes(signal: AbortSignal): Promise<void> {
  for (let bb = readStored(); bb !== null && panes(bb).length > 1; bb = readStored()) {
    signal.throwIfAborted();
    const count = panes(bb).length;
    closeButtonBeside(bb.focusedPaneId).click();
    await untilFrame(() => paneCount() < count, "close a pane", STEP_TIMEOUT_MS, signal);
  }
}

/** The Close pane button of a pane on screen other than `focusedPaneId`. */
function closeButtonBeside(focusedPaneId: string): HTMLButtonElement {
  const pane = Array.from(document.querySelectorAll(`[${PANE}]`)).find((pane) => pane.getAttribute(PANE) !== focusedPaneId);
  const button = pane?.querySelector<HTMLButtonElement>(CLOSE_PANE);
  if (button === undefined || button === null) throw new Error("bb shows no Close pane button on an unfocused pane");
  return button;
}

function paneCount(): number {
  const bb = readStored();
  return bb === null ? 0 : panes(bb).length;
}

/** The threads of `layout`'s panes, in pane order. */
function threadsOf(layout: Layout): string[] {
  return panes(layout).flatMap((pane) => (pane.content.kind === "thread" ? [pane.content.threadId] : []));
}

function focusedThread(layout: Layout): string | null {
  const content = focused(layout).content;
  return content.kind === "thread" ? content.threadId : null;
}
