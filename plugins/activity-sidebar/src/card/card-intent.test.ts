import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { CardIntent, DWELL, GRACE, insideTriangle, SETTLE, WARM, type CardEdge, type Under } from "./card-intent.ts";

// A list: rows a, b, c stacked 30 high at x 0-280 from y 0; the shown card at x 290, y 0-200.
const CARD: CardEdge = { left: 290, top: 0, bottom: 200 };

type Harness = {
  intent: CardIntent;
  under: Under;
  shown: (string | null)[];
  /** How many times focus was handed back to the list. */
  returned: number;
  at(x: number, y: number, row: string | null, onCard?: boolean): void;
};

function harness(): Harness {
  const shown: (string | null)[] = [];
  const h: Harness = {
    shown,
    returned: 0,
    under: { point: { x: 0, y: 0 }, row: null, onCard: false },
    intent: new CardIntent({
      probe: () => h.under,
      cardEdge: () => (shown.at(-1) == null ? null : CARD),
      onChange: (id) => shown.push(id),
      returnFocus: () => h.returned++,
    }),
    at(x, y, row, onCard = false) {
      h.under = { point: { x, y }, row, onCard };
    },
  };
  return h;
}

/** The pointer onto a row at (x, y). */
function over(h: Harness, row: string, x: number, y: number) {
  h.at(x, y, row);
  h.intent.overRow(row);
}

/** The card for `row`, opened by a full rest with the pointer at (x, y). */
function opened(row: string, x = 100, y = 15): Harness {
  const h = harness();
  over(h, row, x, y);
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, [row]);
  return h;
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

test("resting on a row opens its card after the dwell, not before", () => {
  const h = harness();
  over(h, "a", 100, 15);
  mock.timers.tick(DWELL - 1);
  assert.deepEqual(h.shown, []);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["a"]);
});

test("leaving a row before the dwell cancels its card, and the next row waits its full rest", () => {
  const h = harness();
  over(h, "a", 100, 15);
  mock.timers.tick(300);
  h.intent.leaveRow("a");
  over(h, "b", 100, 45);
  mock.timers.tick(DWELL - 1);
  assert.deepEqual(h.shown, []);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["b"]);
});

test("moving straight to another row (away from the card) hands the card over at once", () => {
  const h = opened("a");
  h.intent.leaveRow("a");
  over(h, "b", 100, 45);
  assert.deepEqual(h.shown, ["a", "b"]);
});

test("leaving the row and the card closes it after the grace", () => {
  const h = opened("a");
  h.at(100, -10, null);
  h.intent.leaveRow("a");
  mock.timers.tick(GRACE - 1);
  assert.deepEqual(h.shown, ["a"]);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["a", null]);
});

test("within the warm window the next row's card opens at once; after it, the next waits the dwell", () => {
  const h = opened("a");
  h.intent.leaveRow("a");
  mock.timers.tick(GRACE);
  over(h, "b", 100, 45);
  assert.deepEqual(h.shown, ["a", null, "b"], "warm: at once");

  h.intent.leaveRow("b");
  // why: two ticks, so the close is stamped at its own time (a mocked Date reads the tick's end inside it).
  mock.timers.tick(GRACE);
  mock.timers.tick(WARM);
  over(h, "c", 100, 75);
  assert.deepEqual(h.shown, ["a", null, "b", null], "cold again after the warm window");
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, ["a", null, "b", null, "c"]);
});

test("a cold close (press, scroll, Escape) makes the next row wait its full rest", () => {
  const h = opened("a");
  h.intent.cold();
  over(h, "b", 100, 45);
  assert.deepEqual(h.shown, ["a", null]);
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, ["a", null, "b"]);
});

test("entering the card keeps it; leaving the card for its own row keeps it; leaving it elsewhere closes it after the grace", () => {
  const h = opened("a");
  h.intent.leaveRow("a");
  mock.timers.tick(GRACE - 10);
  h.intent.enterCard();
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"]);

  h.intent.leaveCard("a");
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"]);

  h.intent.leaveCard(null);
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null]);
});

// The pointer leaves row a at (100, 10), heading down-right: across b and c, through the gap, onto the card.
test("crossing two rows diagonally into the card keeps the card on its row", () => {
  const h = opened("a", 100, 10);
  h.intent.leaveRow("a");
  over(h, "b", 150, 45);
  mock.timers.tick(SETTLE - 50);
  over(h, "c", 200, 75);
  mock.timers.tick(SETTLE - 50);
  h.at(285, 100, null);
  h.intent.move();
  mock.timers.tick(SETTLE - 50);
  h.at(291, 110, null, true);
  h.intent.enterCard();
  mock.timers.tick(SETTLE + GRACE + DWELL);
  assert.deepEqual(h.shown, ["a"]);
});

test("stopping on a crossed row for the settle time switches to that row's card", () => {
  const h = opened("a", 100, 10);
  h.intent.leaveRow("a");
  over(h, "b", 150, 45);
  mock.timers.tick(SETTLE - 1);
  assert.deepEqual(h.shown, ["a"]);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["a", "b"]);
});

test("a crossed row is taken at once when the pointer turns away from the card", () => {
  const h = opened("a", 100, 10);
  h.intent.leaveRow("a");
  over(h, "b", 150, 45);
  h.at(120, 50, "b"); // back left, out of the triangle
  h.intent.move();
  assert.deepEqual(h.shown, ["a", "b"]);
});

test("insideTriangle: strictly inside the triangle from the exit to the card's edge, 8 past its ends", () => {
  const exit = { x: 100, y: 10 };
  assert.equal(insideTriangle(exit, CARD, { x: 200, y: 75 }), true, "between the exit and the card");
  assert.equal(insideTriangle(exit, CARD, { x: 289, y: -7 }), true, "just within the 8 above the card's top");
  assert.equal(insideTriangle(exit, CARD, { x: 289, y: -9 }), false, "past the 8 above its top");
  assert.equal(insideTriangle(exit, CARD, { x: 289, y: 205 }), true, "just within the 8 below its bottom");
  assert.equal(insideTriangle(exit, CARD, { x: 289, y: 209 }), false, "past the 8 below its bottom");
  assert.equal(insideTriangle(exit, CARD, { x: 90, y: 12 }), false, "behind the exit");
  assert.equal(insideTriangle(exit, CARD, { x: 120, y: 50 }), false, "below the triangle's lower side");
  assert.equal(insideTriangle(exit, CARD, exit), false, "the apex itself is not on the way");
  assert.equal(insideTriangle(exit, CARD, { x: 295, y: 60 }), false, "past the card's edge");
});

// Keyboard focus holds the card as the pointer does; the card goes once neither is on its row or on it.

/** The card for `row`, opened by keyboard focus resting on it, the pointer away from the list. */
function focusOpened(row: string): Harness {
  const h = harness();
  h.at(600, 400, null);
  h.intent.focusRow(row);
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, [row]);
  return h;
}

test("keyboard focus resting on a row opens its card after the dwell; focus leaving first cuts the rest short", () => {
  const h = focusOpened("a");
  h.intent.blur();
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null]);

  const k = harness();
  k.intent.focusRow("b");
  mock.timers.tick(DWELL - 1);
  k.intent.blur();
  mock.timers.tick(DWELL);
  assert.deepEqual(k.shown, []);
});

test("the pointer leaving a row keyboard focus rests on neither cuts its rest short nor closes its card", () => {
  const h = harness();
  h.intent.focusRow("a");
  over(h, "a", 100, 15);
  h.at(100, -10, null);
  h.intent.leaveRow("a");
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, ["a"], "the rest carried on");

  over(h, "a", 100, 15);
  h.at(100, -10, null);
  h.intent.leaveRow("a");
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"], "focus still holds the card");

  h.intent.blur();
  mock.timers.tick(GRACE - 1);
  assert.deepEqual(h.shown, ["a"]);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["a", null], "both gone: closed after the grace");
});

test("focus moving from the row into the card, and about in it, keeps the card; leaving it closes it after the grace", () => {
  const h = focusOpened("a");
  h.intent.focusCard();
  h.intent.focusCard();
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"]);

  h.intent.blur();
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null]);
  assert.equal(h.returned, 0, "focus that left the card on its own stays where it went");
});

test("the pointer leaving the card while focus is in it keeps the card; focus leaving too closes it", () => {
  const h = opened("a");
  h.intent.enterCard();
  h.intent.focusCard();
  h.intent.leaveCard(null);
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"]);

  h.intent.blur();
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null]);
});

test("focus leaving while the pointer is on the card keeps it", () => {
  const h = focusOpened("a");
  h.intent.enterCard();
  h.intent.blur();
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"]);
});

test("Escape with focus in the card closes it at once and hands focus back; focus landing on its row does not reopen it", () => {
  const h = focusOpened("a");
  h.intent.focusCard();
  h.intent.cold();
  assert.deepEqual(h.shown, ["a", null]);
  assert.equal(h.returned, 1);

  h.intent.focusRow("a");
  mock.timers.tick(DWELL * 3);
  assert.deepEqual(h.shown, ["a", null], "not reopened");

  h.intent.blur();
  h.intent.focusRow("a");
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, ["a", null, "a"], "focus coming back from elsewhere rests again");
});

test("a cold close with focus outside the card leaves focus where it is", () => {
  const h = focusOpened("a");
  h.intent.cold();
  const p = opened("b");
  p.intent.cold();
  assert.equal(h.returned + p.returned, 0);
});

test("the card moving to another row while focus is in it hands focus back; that focus holds nothing", () => {
  const h = focusOpened("a");
  h.intent.focusCard();
  over(h, "b", 100, 45);
  assert.deepEqual(h.shown, ["a", "b"]);
  assert.equal(h.returned, 1);

  h.intent.focusRow("a");
  h.at(100, 200, null);
  h.intent.leaveRow("b");
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", "b", null], "b's card goes with the pointer; a's row does not reopen its own");
});

test("focus handed from the card to another row (its own row gone) lets the card go after the grace", () => {
  const h = focusOpened("a");
  h.intent.focusCard();
  h.intent.focusRow("b");
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null]);
  mock.timers.tick(DWELL);
  assert.deepEqual(h.shown, ["a", null], "nor does it open the heir's");
});

// A crossing toward the card (as in the triangle tests above) that ends off the rows and off the card.

/** From row a's exit at (100, 10) across row b, as the pointer heads for the card. */
function crossB(h: Harness) {
  over(h, "a", 100, 10);
  h.intent.leaveRow("a");
  over(h, "b", 150, 45);
  h.at(150, 61, null);
  h.intent.leaveRow("b");
}

test("a crossing that stops between the rows and the card closes the card after the grace", () => {
  const h = opened("a", 100, 10);
  crossB(h);
  h.at(285, 100, null); // in the gap, inside the triangle
  h.intent.move();
  mock.timers.tick(SETTLE);
  mock.timers.tick(GRACE - 1);
  assert.deepEqual(h.shown, ["a"]);
  mock.timers.tick(1);
  assert.deepEqual(h.shown, ["a", null]);
});

test("a crossing that stops between the rows and the card keeps the card while focus is on its row", () => {
  const h = focusOpened("a");
  crossB(h);
  h.at(285, 100, null);
  h.intent.move();
  mock.timers.tick(SETTLE);
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"], "focus still holds the card");

  h.intent.blur();
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null], "both gone: closed after the grace");
});

test("a crossing that turns away off the rows keeps the card while focus is in it", () => {
  const h = focusOpened("a");
  h.intent.focusCard();
  crossB(h);
  h.at(60, 120, null); // back left below the list: out of the triangle and off the rows
  h.intent.move();
  mock.timers.tick(GRACE * 3);
  assert.deepEqual(h.shown, ["a"], "focus still holds the card");
  assert.equal(h.returned, 0);

  h.intent.blur();
  mock.timers.tick(GRACE);
  assert.deepEqual(h.shown, ["a", null], "both gone: closed after the grace");
});
