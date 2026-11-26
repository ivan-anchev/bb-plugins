// Tests only: one page of the app in a worker thread, so it has its own document and its own copy of
// every module, as a reloaded tab does, and starts with only the browser storage the page before it
// left. It opens WEB-1's tab with d9 open and plays its step: "type" types `words` into the own-words
// field; "send" sends what the field holds with Enter and follows the answer until it lands. It posts
// what it saw, and the storage it leaves.
import "../../../../test-browser.ts";
import { parentPort, workerData } from "node:worker_threads";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { openQuestion, press, watchFocusDrops } from "./test-question.ts";

export type PageStep = { step: "type" | "send"; words: string; storage: [string, string][] };

const { step, words, storage }: PageStep = workerData;
for (const [key, value] of storage) localStorage.setItem(key, value);
const page = await openQuestion();
parentPort?.postMessage(step === "type" ? typeWords() : await sendWords());
process.exit(0);

function typeWords() {
  fireEvent.change(page.field(), { target: { value: words } });
  return { storage: Object.entries(localStorage) };
}

/** What the page shows as it sends the field's words and the answer lands. */
async function sendWords() {
  const kept = page.field().value;
  page.field().focus();
  const focus = watchFocusDrops();
  press("Enter");
  await waitFor(() => {
    if (page.answers.length === 0) throw new Error("nothing sent yet");
  });
  const own = page.field().closest("form");
  const sending = {
    answers: page.answers,
    status: own === null ? null : within(own).queryByRole("status")?.textContent,
    readOnly: page.field().readOnly,
    focusInField: document.activeElement === page.field(),
  };
  await act(() => page.answered(kept));
  await waitFor(() => {
    if (!/You answered/.test(page.card().textContent ?? "")) throw new Error("not answered yet");
  });
  const answered = { shown: (page.card().textContent ?? "").split(kept).length - 1, focusOnCard: document.activeElement === page.card(), dropped: focus.dropped() };
  focus.stop();
  return { kept, sending, answered };
}
