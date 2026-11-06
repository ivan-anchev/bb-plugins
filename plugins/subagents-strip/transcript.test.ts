// The transcript tab's params boundary: what Open thread writes, bb persists as
// JSON, and the tab reads back, on the real fixture's delegates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import type { EventRow, TimelineRow } from "./bb.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { parseTranscriptParams, transcriptParams } from "./transcript.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const delegates = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events));

test("params written for a delegate name the same delegate after a round trip through persistence", () => {
  for (const d of delegates) {
    const persisted: JsonValue = JSON.parse(JSON.stringify(transcriptParams(d.id)));
    const id = parseTranscriptParams(persisted);
    assert.equal(id, d.id);
    assert.equal(delegates.find((other) => other.id === id), d);
  }
});

test("params that name no delegate read as none, whatever shape the host hands back", () => {
  const unnamed: JsonValue[] = [null, "dae8e73ef7-i18", 7, true, [], [{ delegateId: "dae8e73ef7-i18" }], {}, { delegateId: 7 }, { delegateId: "" }, { delegateId: null }];
  for (const params of unnamed) assert.equal(parseTranscriptParams(params), null, JSON.stringify(params));
});
