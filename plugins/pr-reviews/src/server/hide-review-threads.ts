// Review threads PR Reviews started before it spawned them hidden still crowd bb's sidebar. This
// hides them, once: a thread the user shows again afterwards stays shown. Only threads PR Reviews
// started are touched, including ones its runs and guides no longer name (a replaced run's).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const HIDDEN_KEY = "started-review-threads-hidden";

const THREADS_PER_PAGE = 200;

type ListArgs = NonNullable<Parameters<BbPluginApi["sdk"]["threads"]["list"]>[0]>;

// The parts of bb hiding reads and writes, down to the fields it uses.
type Bb = {
  pluginId: string;
  background: { service(name: string, service: { start(signal: AbortSignal): Promise<void> }): void };
  storage: { kv: { get(key: string): Promise<unknown>; set(key: string, value: true): Promise<void> } };
  sdk: {
    threads: {
      list(args: ListArgs): Promise<{ id: string }[]>;
      update(args: { threadId: string; visibility: "hidden" }): Promise<unknown>;
    };
  };
};

/**
 * Runs the hiding at the plugin's first load; a failure is retried by bb's service restart. An
 * abort (reload, disable, shutdown) stops it between calls to bb, and the next load finishes it.
 */
export function registerHideReviewThreads(bb: Bb): void {
  bb.background.service("hide-review-threads", {
    async start(signal) {
      try {
        await hideReviewThreadsOnce(bb, signal);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
      await untilAborted(signal);
    },
  });
}

// The flag is set only once every thread is hidden, so a failed or stopped run is retried, and the
// retry lists only the threads still shown.
async function hideReviewThreadsOnce(bb: Bb, signal: AbortSignal): Promise<void> {
  if ((await whileRunning(signal, () => bb.storage.kv.get(HIDDEN_KEY))) === true) return;
  const shown = await shownThreadsStartedBy(bb, signal);
  await whileRunning(signal, () => Promise.all(shown.map((thread) => bb.sdk.threads.update({ threadId: thread.id, visibility: "hidden" }))));
  await whileRunning(signal, () => bb.storage.kv.set(HIDDEN_KEY, true));
}

// Every page is read before anything is hidden: hiding a thread moves it out of the list.
async function shownThreadsStartedBy(bb: Bb, signal: AbortSignal): Promise<{ id: string }[]> {
  const threads: { id: string }[] = [];
  for (let offset = 0; ; offset += THREADS_PER_PAGE) {
    const page = await whileRunning(signal, () =>
      bb.sdk.threads.list({ originPluginId: bb.pluginId, archived: false, limit: THREADS_PER_PAGE, offset }),
    );
    threads.push(...page);
    if (page.length < THREADS_PER_PAGE) return threads;
  }
}

// Makes one call to bb while the service runs: an aborted service makes no call, and an abort
// during the call rejects at once, so nothing after it starts.
async function whileRunning<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let stop!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([call(), aborted]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
