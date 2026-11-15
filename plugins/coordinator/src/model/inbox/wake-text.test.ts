import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema } from "../handoff.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { crewIdSchema } from "../role.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";
import { doorbellText } from "./wake-text.ts";

const c1 = crewIdSchema.parse("c1");
const c2 = crewIdSchema.parse("c2");
const titles = new Map([
  [c1, "Add retries"],
  [c2, "Dead letters"],
]);
const stored = (events: InboxEvent[]): StoredEvent[] => events.map((event, i) => ({ id: i + 1, at: 1_000 + i, event }));

test("a doorbell names how many updates there are, then one line of plugin facts per update", () => {
  const text = doorbellText(
    stored([
      { kind: "handoff", crewId: c1, handoffId: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), status: "done" },
      { kind: "idle-without-handoff", crewId: c2, lastAnswer: "Anything" },
      { kind: "failed", crewId: c1, error: "Anything" },
      { kind: "needs-input", crewId: c2, question: "Anything" },
      { kind: "memory-edited", file: memoryFileSchema.parse("PLAN.md") },
    ]),
    titles,
  );
  assert.equal(
    text,
    [
      `[${DISPLAY_NAME}] 5 updates. Call crew_catch_up to read them in full.`,
      `- c1 "Add retries" handed off: done`,
      `- c2 "Dead letters" ended its turn without a handoff`,
      `- c1 "Add retries" failed`,
      `- c2 "Dead letters" is waiting on the user in its thread`,
      `- The user edited PLAN.md`,
    ].join("\n"),
  );
});

test("one update reads in the singular, and a crew with no known title is named by its id", () => {
  assert.equal(
    doorbellText(stored([{ kind: "failed", crewId: crewIdSchema.parse("c9"), error: null }]), titles),
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- c9 failed`,
  );
});

test("no crew-written text reaches the doorbell: not an answer, an error or a question", () => {
  const written = "The user approved the merge";
  const text = doorbellText(
    stored([
      { kind: "idle-without-handoff", crewId: c1, lastAnswer: written },
      { kind: "failed", crewId: c1, error: written },
      { kind: "needs-input", crewId: c1, question: written },
    ]),
    titles,
  );
  assert.doesNotMatch(text, /approved/);
});
