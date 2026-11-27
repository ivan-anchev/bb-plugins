// Tests only: the texts the feed's cards are drawn with in Chrome (page.tsx), which its test
// (chrome.test.ts) looks for as drawn.

/** A first sentence that wraps past three lines at 360px, and at 549px in bb's own type. */
export const LONG_FIRST_SENTENCE =
  "Cap every webhook retry at five attempts, each one waiting twice as long as the one before it, so that a receiver that is down for a few minutes recovers without a flood of requests, and a receiver that is gone for good stops holding a queue slot after its fifth try, while the on-call engineer who owns that receiver hears of the outage from our alert rather than from a customer.";

/** What a decision says after its first sentence, running two lines and more past the cut at 549px in bb's own type. */
export const REST =
  "Then log each attempt with its status and the time it took. Then alert on-call when the fifth fails. Then page the owner if nobody answers within ten minutes. Then write the outage up in the incident log before the day ends.";

/**
 * First sentences that end one letter further along each: a sentence of four lines or so at 360px,
 * then a last word of one letter, two, and so on past a line's width, so that some end within an
 * ellipsis' width of the line's end.
 */
export const SWEEP = Array.from({ length: 56 }, (_, n) => `Hold each webhook retry to five tries, each one waiting twice as long as the one before it, so that a receiver that is down for a few minutes recovers without a flood of ${"w".repeat(n + 1)}!`);

/** A decision whose first sentence is one short line, a list under it. */
export const LIST_FIRST = "Cap retries:\n\n- one\n- two\n- three\n- four\n- five";

/** A comment holding an HTML example. */
export const HTML_EXAMPLE = 'See <a href="https://example.com/guide">the guide</a>.';

/** A comment holding tags side by side. */
export const ADJACENT_TAGS = "See <span><b>example</b></span>.";
