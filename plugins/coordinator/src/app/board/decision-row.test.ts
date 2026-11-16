import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { decisionIdSchema, type Decision } from "../../model/decision.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

// QA-02: bb redrawing the board across its breakpoint remounted an open decision and emptied the
// answer typed into it. The row keeps it in the browser instead, until the decision is answered.

const { DecisionRow } = await import("./decision-row.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const OPEN: Decision = { id: decisionIdSchema.parse("d2"), question: "Which zone first?", options: ["eu-west", "us-east"], askedAt: 1_000, answer: null };
const TYPED = "Freeform unsent QA,\nwith a second line";
const answered = (text: string): Decision => ({ ...OPEN, answer: { text, at: 2_000 } });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The decision's row on the board, as bb mounts it; every answer sent reaches `answers`. */
function mount(decision: Decision, answers: unknown[] = [], coordinatorId = COORDINATOR) {
  const props = { ref: null, coordinatorId, decision };
  const view = renderSlot({ component: DecisionRow }, props, {
    rpc: {
      answerDecision: (input: unknown) => {
        answers.push(input);
        return {};
      },
    },
  });
  return {
    view,
    field(): HTMLTextAreaElement {
      const field = view.getByRole("textbox", { name: "Your answer, in your own words" });
      assert.ok(field instanceof HTMLTextAreaElement);
      return field;
    },
    type: (text: string) => fireEvent.change(view.getByRole("textbox"), { target: { value: text } }),
    /** The board reads the decision again, as it does when it is answered, here or elsewhere. */
    reread: (next: Decision) => view.rerender(createElement(DecisionRow, { ...props, decision: next })),
  };
}

test("an unsent answer is still in the field after the board remounts, and once sent and read back answered the browser keeps none", async () => {
  const answers: unknown[] = [];
  mount(OPEN).type(TYPED);
  cleanup();

  const row = mount(OPEN, answers);
  assert.equal(row.field().value, TYPED);
  await act(async () => fireEvent.click(row.view.getByRole("button", { name: "Send" })));
  assert.deepEqual(answers, [{ coordinatorId: COORDINATOR, decisionId: "d2", answer: TYPED }]);
  row.reread(answered(TYPED));

  assert.match(row.view.container.textContent ?? "", /You answered: Freeform unsent QA,\nwith a second line/);
  assert.equal(localStorage.length, 0);
});

test("a decision answered elsewhere drops the answer typed here, so the browser keeps none", () => {
  const row = mount(OPEN);
  row.type("Not sent");
  row.reread(answered("eu-west"));
  assert.equal(localStorage.length, 0);
});

test("the answer typed is kept by Coordinator and decision, and an emptied field keeps none", () => {
  mount(OPEN).type(TYPED);
  cleanup();
  assert.equal(mount({ ...OPEN, id: decisionIdSchema.parse("d1") }).field().value, "", "another decision has none");
  cleanup();
  assert.equal(mount(OPEN, [], coordinatorIdSchema.parse("0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40")).field().value, "", "nor another Coordinator's d2");
  cleanup();

  mount(OPEN).type("");
  assert.equal(localStorage.length, 0);
});

test("what the browser holds that isn't an answer reads as none", () => {
  const key = `coordinator-decision-answer:${COORDINATOR}:d2`;
  for (const stored of ["{not json", JSON.stringify(""), JSON.stringify(42), JSON.stringify("x".repeat(5_001))]) {
    localStorage.setItem(key, stored);
    assert.equal(mount(OPEN).field().value, "", stored);
    cleanup();
  }
});
