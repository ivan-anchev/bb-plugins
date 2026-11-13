import assert from "node:assert/strict";
import { test } from "node:test";
import { foldPlan, type PlanView, type Todos } from "./plan-fold.ts";

type Status = Todos["items"][number]["status"];
const STATUS: Record<string, Status> = { c: "completed", d: "in_progress", p: "pending" };

/** A plan from one letter a step: c completed, d in progress, p pending; any other letter an unknown status. */
function plan(letters: string): Todos {
  const items = [...letters].map((letter, i) => ({ id: `t${i + 1}`, text: `Step ${i + 1}`, status: STATUS[letter] ?? (letter as Status) }));
  return { items, sourceSeq: 1, updatedAt: 0 };
}

/** The view in short: "earlier [shown ids] later", and done/total. */
function shape(view: PlanView | null): string | null {
  if (view === null) return null;
  return `${view.done}/${view.total} ${view.earlier} [${view.steps.map((s) => s.id).join(" ")}] ${view.later}`;
}

test("six steps show whole", () => {
  assert.equal(shape(foldPlan(plan("ccdppp"), false)), "2/6 0 [t1 t2 t3 t4 t5 t6] 0");
});

test("seven steps fold to the step in progress and one either side", () => {
  assert.equal(shape(foldPlan(plan("ccdpppp"), false)), "2/7 1 [t2 t3 t4] 3");
});

test("twenty steps fold around the step in progress, and keep three at either end", () => {
  assert.equal(shape(foldPlan(plan(`${"c".repeat(9)}d${"p".repeat(10)}`), false)), "9/20 8 [t9 t10 t11] 9");
  assert.equal(shape(foldPlan(plan(`d${"p".repeat(19)}`), false)), "0/20 0 [t1 t2 t3] 17");
  assert.equal(shape(foldPlan(plan(`${"c".repeat(19)}d`), false)), "19/20 17 [t18 t19 t20] 0");
});

test("the issue's capture: nine steps, the fourth in progress, fold to 2 earlier and 4 later", () => {
  const view = foldPlan(plan("cccdppppp"), false);
  assert.equal(shape(view), "3/9 2 [t3 t4 t5] 4");
  assert.deepEqual(
    view?.steps.map((s) => s.state),
    ["done", "doing", "pending"],
  );
});

test("open shows every step", () => {
  assert.equal(shape(foldPlan(plan(`${"c".repeat(9)}d${"p".repeat(10)}`), true)), "9/20 0 [t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11 t12 t13 t14 t15 t16 t17 t18 t19 t20] 0");
});

test("no step in progress: it folds around the first pending one", () => {
  assert.equal(shape(foldPlan(plan("cccccpppp"), false)), "5/9 4 [t5 t6 t7] 2");
  assert.equal(shape(foldPlan(plan("ppppppppp"), false)), "0/9 0 [t1 t2 t3] 6");
});

test("all done: the last three", () => {
  assert.equal(shape(foldPlan(plan("ccccccccc"), false)), "9/9 6 [t7 t8 t9] 0");
});

test("a status bb doesn't know yet reads as pending", () => {
  const view = foldPlan(plan("cxp"), false);
  assert.deepEqual(
    view?.steps.map((s) => s.state),
    ["done", "pending", "pending"],
  );
  assert.equal(view?.done, 1);
  // It counts as pending for the fold's focus too: the first not-done step.
  assert.equal(shape(foldPlan(plan("ccxpppp"), false)), "2/7 1 [t2 t3 t4] 3");
});

test("a plan with no steps has no view", () => {
  assert.equal(foldPlan(plan(""), false), null);
});
