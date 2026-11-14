// The card's header is where focus goes when the row that had it leaves the card. The Spotlight
// sends it there after a note it showed is deleted, since that note's row is leaving too.

const HEADER = "data-nt-card-header";

/** Spread on the card's header: focusable by script, not by Tab. */
export const CARD_HEADER = { [HEADER]: "", tabIndex: -1 };

export function focusCardHeader(): void {
  // why optional: the card is on the New thread screen only, and bb may have moved on from it.
  document.querySelector<HTMLElement>(`[${HEADER}]`)?.focus();
}
