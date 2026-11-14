// When the hover card shows, and for which row. One machine per list, so the card hands off warm from
// row to row and the pointer can cross other rows on its way to it. No DOM, no React: the list feeds it
// pointer and focus facts and it says which row's card is shown. Ported from the prototype,
// which follows Zeron.
// Zeron's card takes no keyboard; here focus holds a card as the pointer does, so a keyboard reader can
// keep it open and work its rows (REVIEW.md: a popup stays while hovered or while its trigger has focus).

/** Resting on a row this long opens its card. */
export const DWELL = 550;
/** Within this long of one card going, the next opens at once. */
export const WARM = 400;
/** Leaving the row and its card, the card stays this long, so a pointer on its way over keeps it. */
export const GRACE = 150;
/** Crossing rows on the way to the card, stopping on one this long takes that row. */
export const SETTLE = 150;

export type Point = { x: number; y: number };
/** The card's near edge, in the window's coordinates. */
export type CardEdge = { left: number; top: number; bottom: number };
/** What lies under the pointer now: a row's key, the card, or neither. */
export type Under = { point: Point; row: string | null; onCard: boolean };

export type CardIntentDeps = {
  probe(): Under;
  /** The shown card's edge; null while none is laid out. */
  cardEdge(): CardEdge | null;
  onChange(shown: string | null): void;
  /** Focus was in a card that went: put it back on the card's row, or what the list has in its place. */
  returnFocus(): void;
};

/** The card itself, where the pointer or focus may be besides a row. */
const CARD = Symbol("card");
/** Where the pointer, or focus, is: a row's key, the card, or neither. */
type Spot = string | typeof CARD | null;

export class CardIntent {
  private readonly deps: CardIntentDeps;
  private shown: string | null = null;
  private waiting: string | null = null;
  /** Each holds the card while on its row or on the card; it goes once neither does. */
  private pointer: Spot = null;
  private focus: Spot = null;
  /** When the last card went; -Infinity after a cold close, so the next waits its full rest. */
  private goneAt = -Infinity;
  /** Where the pointer last stood in the shown card's row before it left: the safe triangle's apex. */
  private exit: Point | null = null;
  /** A row crossed on the way to the card, taken if the pointer settles on it. */
  private passing: string | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: CardIntentDeps) {
    this.deps = deps;
  }

  /** Whether `row`'s card is the one shown. */
  shows(row: string): boolean {
    return this.shown === row;
  }

  /** The pointer came onto a row. */
  overRow(row: string): void {
    this.pointer = row;
    // why: crossing another row on the way to the open card is not resting on it.
    if (this.shown !== null && this.shown !== row && this.headingToCard()) {
      clearTimeout(this.graceTimer);
      this.passing = row;
      this.settle();
      return;
    }
    clearTimeout(this.settleTimer);
    this.passing = null;
    this.rest(row);
  }

  /** The pointer left a row for anywhere but its own card. */
  leaveRow(row: string): void {
    if (this.pointer === row) this.pointer = null;
    if (row !== this.cardRow()) return;
    if (this.shown === row) this.exit = this.deps.probe().point;
    this.vacate();
  }

  enterCard(): void {
    this.pointer = CARD;
    clearTimeout(this.graceTimer);
    clearTimeout(this.settleTimer);
    this.passing = null;
    this.exit = null;
  }

  /** Leaving the card for its own row keeps it; anywhere else, it goes after the grace. */
  leaveCard(toRow: string | null): void {
    this.pointer = null;
    if (toRow !== null && toRow === this.shown) return;
    this.vacate();
  }

  /** The pointer moved: a row crossed on the way is taken once the pointer stops or turns away. */
  move(): void {
    if (this.passing !== null) this.settle();
  }

  /** Keyboard focus came onto a row: it rests there as the pointer would. Focus handed back from the card does not. */
  focusRow(row: string): void {
    const fromCard = this.focus === CARD;
    this.focus = row;
    if (fromCard) this.vacate();
    else this.rest(row);
  }

  focusCard(): void {
    this.focus = CARD;
    clearTimeout(this.graceTimer);
  }

  /** Focus left for somewhere that is neither a row nor the card, or onto a row the pointer pressed. */
  blur(): void {
    const held = this.holds(this.focus);
    this.focus = null;
    if (held) this.vacate();
  }

  /** A press, a scroll, a context menu, Escape, or its row leaving: away, and the next waits its full rest. */
  cold(): void {
    this.hide(true);
  }

  // ---------------------------------------------------------------- layer 2

  private rest(row: string): void {
    clearTimeout(this.graceTimer);
    if (this.shown === row || this.waiting === row) return;
    clearTimeout(this.dwellTimer);
    if (this.shown !== null || Date.now() - this.goneAt < WARM) return this.show(row);
    this.waiting = row;
    this.dwellTimer = setTimeout(() => this.show(row), DWELL);
  }

  /** Still on its way: wait. Stopped SETTLE ms, or turned away: take what is under it. */
  private settle(): void {
    clearTimeout(this.settleTimer);
    if (this.deps.probe().onCard) {
      this.passing = null;
      return;
    }
    if (this.headingToCard()) {
      this.settleTimer = setTimeout(() => this.take(), SETTLE);
      return;
    }
    this.take();
  }

  /** A crossing that ends off the rows and off the card left both: the card goes as any departure does. */
  private take(): void {
    this.passing = null;
    const under = this.deps.probe();
    if (under.row !== null) this.rest(under.row);
    else if (!under.onCard) this.vacate();
  }

  private headingToCard(): boolean {
    const edge = this.deps.cardEdge();
    return this.exit !== null && edge !== null && insideTriangle(this.exit, edge, this.deps.probe().point);
  }

  /** The row whose card is shown, or is waiting out its rest. */
  private cardRow(): string | null {
    return this.shown ?? this.waiting;
  }

  private holds(spot: Spot): boolean {
    return spot === CARD ? this.shown !== null : spot !== null && spot === this.cardRow();
  }

  /** The pointer or focus left the card's row or the card: once neither holds it, a rest is cut short and a card goes after the grace. */
  private vacate(): void {
    if (this.holds(this.pointer) || this.holds(this.focus)) return;
    if (this.shown === null) this.hide(false);
    else this.hideAfterGrace();
  }

  private hideAfterGrace(): void {
    clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.hide(false), GRACE);
  }

  private show(row: string): void {
    const handBack = this.focus === CARD && this.shown !== null;
    clearTimeout(this.dwellTimer);
    this.waiting = null;
    this.shown = row;
    this.deps.onChange(row);
    if (handBack) this.deps.returnFocus();
  }

  private hide(cold: boolean): void {
    clearTimeout(this.dwellTimer);
    clearTimeout(this.graceTimer);
    clearTimeout(this.settleTimer);
    this.waiting = null;
    this.passing = null;
    this.exit = null;
    // why: only a card that went warms the next; a rest cut short leaves the clock as it was.
    if (this.shown !== null) {
      this.shown = null;
      this.goneAt = cold ? -Infinity : Date.now();
      this.deps.onChange(null);
      if (this.focus === CARD) this.deps.returnFocus();
    } else if (cold) this.goneAt = -Infinity;
  }
}

/**
 * Strictly inside the triangle from `exit` to the card's near edge, reaching 8 past its top and bottom.
 * On an edge, its apex included, is not on the way.
 */
export function insideTriangle(exit: Point, card: CardEdge, p: Point): boolean {
  const top = { x: card.left, y: card.top - 8 };
  const bottom = { x: card.left, y: card.bottom + 8 };
  const s1 = side(p, exit, top);
  const s2 = side(p, top, bottom);
  const s3 = side(p, bottom, exit);
  return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0);
}

function side(p1: Point, p2: Point, p3: Point): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}
