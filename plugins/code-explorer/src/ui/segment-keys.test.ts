import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { segmentIndexAfterKey } from "./segment-index.ts";

describe("segmentIndexAfterKey", () => {
  test("arrows step to the neighbouring segment", () => {
    assert.equal(segmentIndexAfterKey("ArrowRight", 0, 3), 1);
    assert.equal(segmentIndexAfterKey("ArrowLeft", 2, 3), 1);
  });

  test("arrows wrap past either end", () => {
    assert.equal(segmentIndexAfterKey("ArrowRight", 2, 3), 0);
    assert.equal(segmentIndexAfterKey("ArrowLeft", 0, 3), 2);
  });

  test("vertical arrows step like horizontal ones", () => {
    assert.equal(segmentIndexAfterKey("ArrowDown", 0, 3), 1);
    assert.equal(segmentIndexAfterKey("ArrowUp", 0, 3), 2);
  });

  test("Home and End jump to the ends", () => {
    assert.equal(segmentIndexAfterKey("Home", 2, 3), 0);
    assert.equal(segmentIndexAfterKey("End", 0, 3), 2);
  });

  test("ignores keys a tablist does not own", () => {
    assert.equal(segmentIndexAfterKey("Enter", 0, 3), null);
    assert.equal(segmentIndexAfterKey("Tab", 0, 3), null);
  });
});
