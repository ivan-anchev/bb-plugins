import type { BbPluginApi } from "@get-bb/plugin-sdk";

const HIDDEN_KEY = "started-review-threads-hidden";

const THREADS_PER_PAGE = 200;

type ListArgs = NonNullable<Parameters<BbPluginApi["sdk"]["threads"]["list"]>[0]>;

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

async function hideReviewThreadsOnce(bb: Bb, signal: AbortSignal): Promise<void> {
  if ((await whileRunning(signal, () => bb.storage.kv.get(HIDDEN_KEY))) === true) return;
  const shown = await shownThreadsStartedBy(bb, signal);
  await whileRunning(signal, () => Promise.all(shown.map((thread) => bb.sdk.threads.update({ threadId: thread.id, visibility: "hidden" }))));
  await whileRunning(signal, () => bb.storage.kv.set(HIDDEN_KEY, true));
}

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
