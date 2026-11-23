// A bounded wait on work that keeps running: what an issue's turn (issues/issue-turns.ts) and the
// tick's read of every manager's views (issues/views/view-watch.ts) wait for without letting a call
// bb never answers hold them.

/** Whether `promise` settles within `ms`. The timer is cleared either way; `promise` runs on. */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}
