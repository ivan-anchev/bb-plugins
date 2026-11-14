import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { noteIdSchema } from "../../contract.ts";
import { spotlight, useSpotlightState } from "./spotlight-store.ts";

/** The Spotlight's state as a component sees it. */
function render(): ReturnType<typeof useSpotlightState> {
  let seen: ReturnType<typeof useSpotlightState> | undefined;
  renderToStaticMarkup(createElement(() => ((seen = useSpotlightState()), null)));
  assert.ok(seen);
  return seen;
}

test("closing an opening that was dismissed and reopened leaves the new one open", () => {
  spotlight.compose(null);
  const first = render();
  spotlight.close(first); // dismissed while its save was still in flight
  spotlight.compose(null);
  const second = render();

  spotlight.close(first); // the first opening's save finishes

  assert.equal(render(), second);
  assert.equal(render().kind, "compose");
  spotlight.close(second);
  assert.equal(render().kind, "closed");
});

test("opening a note while a draft is open keeps the draft", () => {
  spotlight.compose(null);
  const draft = render();

  spotlight.view(noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001"));

  assert.equal(render(), draft);
  spotlight.close(draft);
  assert.equal(render().kind, "closed");
});
