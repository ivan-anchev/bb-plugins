// Tells a double-click (or a double Enter) on a UI block's submit apart from
// a deliberate resubmission. bb's send resolves in tens of milliseconds, before
// a human's second click lands, so "a send is still in flight" can't catch it.
// A repeat is the same answer again within a double-click's reach instead.

export interface SentAnswer {
  text: string;
  /** Milliseconds on a monotonic clock, such as `performance.now()`. */
  at: number;
}

// Operating systems treat clicks up to 500ms apart as a double-click by
// default. Double that leaves room for slower hands while a deliberate resend
// a moment later still goes through.
const REPEAT_WINDOW_MS = 1000;

export function isRepeatedAnswer(previous: SentAnswer | undefined, next: SentAnswer): boolean {
  return previous !== undefined && previous.text === next.text && next.at - previous.at < REPEAT_WINDOW_MS;
}
