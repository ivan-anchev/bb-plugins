/**
 * Resolves on the first animation frame `done` holds, checking at once; rejects once `timeoutMs` pass,
 * saying bb did not `what`, and with the signal's reason once it aborts. Either way it stops polling.
 */
export function untilFrame(done: () => boolean, what: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      reject(signal.reason);
    };
    const settle = (finish: () => void) => {
      signal.removeEventListener("abort", stop);
      finish();
    };
    const check = () => {
      if (done()) settle(resolve);
      else if (performance.now() > deadline) settle(() => reject(new Error(`bb did not ${what} within ${timeoutMs} ms`)));
      else frame = requestAnimationFrame(check);
    };
    signal.addEventListener("abort", stop, { once: true });
    check();
  });
}
