import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionEvent } from "@openuidev/react-lang";
import { formatActionMessage } from "./action-message.ts";

test("a button outside a form sends its message alone", () => {
  assert.equal(formatActionMessage(action({ humanFriendlyMessage: "Tell me more" })), "Tell me more");
});

test("a form submit lists each answered field under the message", () => {
  const formState = {
    contact: {
      name: field("Ada Lovelace", "Input"),
      email: field("ada@example.com", "Input"),
      plan: field("pro", "Select"),
    },
  };
  assert.equal(
    formatActionMessage(action({ humanFriendlyMessage: "Submit", formState, formName: "contact" })),
    "Submit\n\n- name: Ada Lovelace\n- email: ada@example.com\n- plan: pro",
  );
});

test("blank fields are left out", () => {
  const formState = {
    contact: { name: field("Ada", "Input"), notes: field("  ", "TextArea"), phone: field(undefined, "Input") },
  };
  assert.equal(formatActionMessage(action({ humanFriendlyMessage: "Submit", formState })), "Submit\n\n- name: Ada");
});

test("lists, checkbox groups, numbers and dates read as plain text", () => {
  const formState = {
    prefs: {
      tools: field(["slack", "notion"], "Chips"),
      channels: field({ email: true, sms: false, push: true }),
      budget: field([40], "Slider"),
      start: field(new Date(2026, 10, 7), "DatePicker"),
    },
  };
  assert.equal(
    formatActionMessage(action({ humanFriendlyMessage: "Save", formState })),
    "Save\n\n- tools: slack, notion\n- channels: email, push\n- budget: 40\n- start: 2026-11-07",
  );
});

// CheckBoxGroup and SwitchGroup store nothing until the user toggles an item,
// then store every item's state. Chips store `[]` once the last chip is
// deselected. So a stored empty selection is a deliberate answer.
test("a checkbox or switch group turned all off reads as none", () => {
  const formState = {
    prefs: {
      channels: field({ email: false, sms: false }),
      alerts: field({ weekly: false, marketing: false }),
    },
  };
  assert.equal(
    formatActionMessage(action({ humanFriendlyMessage: "Save", formState })),
    "Save\n\n- channels: none\n- alerts: none",
  );
});

test("chips with every chip deselected read as none", () => {
  const formState = { prefs: { tools: field([], "Chips") } };
  assert.equal(formatActionMessage(action({ humanFriendlyMessage: "Save", formState })), "Save\n\n- tools: none");
});

test("bound $variables and fields outside a form are answers too", () => {
  const formState = { $plan: "Pro", seats: field(12, "Slider") };
  assert.equal(
    formatActionMessage(action({ humanFriendlyMessage: "Get a quote", formState })),
    "Get a quote\n\n- plan: Pro\n- seats: 12",
  );
});

test("hidden context from @ToAssistant comes last, as JSON", () => {
  const event = action({ humanFriendlyMessage: "Approve", params: { context: { orderId: 42 } } });
  assert.equal(formatActionMessage(event), 'Approve\n\nContext: {"orderId":42}');
});

function action(overrides: Partial<ActionEvent>): ActionEvent {
  return { type: "continue_conversation", params: {}, humanFriendlyMessage: "", formState: {}, ...overrides };
}

// Inputs written through useStateField (checkbox and switch groups among them)
// store `componentType: undefined`.
function field(value: unknown, componentType?: string) {
  return { value, componentType };
}
