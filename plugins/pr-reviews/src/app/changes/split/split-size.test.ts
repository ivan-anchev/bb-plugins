import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MIN_TREE_SIZE, MIN_VIEWER_SIZE, clampedTreeSize, treeSizeAfterKey, treeSizeRangeOf } from "./split-size.ts";

describe("clampedTreeSize", () => {
  test("keeps a size that leaves room for both panes", () => {
    assert.equal(clampedTreeSize(300, 900), 300);
  });

  test("never shrinks the tree below its minimum", () => {
    assert.equal(clampedTreeSize(10, 900), MIN_TREE_SIZE);
  });

  test("always leaves the viewer its minimum", () => {
    assert.equal(clampedTreeSize(880, 900), 900 - MIN_VIEWER_SIZE);
  });

  test("rounds to whole pixels", () => {
    assert.equal(clampedTreeSize(300.6, 900), 301);
  });
});

describe("treeSizeRangeOf", () => {
  test("spans from the tree minimum to the room left beside the viewer", () => {
    assert.deepEqual(treeSizeRangeOf(320, 855), { min: MIN_TREE_SIZE, max: 855 - MIN_VIEWER_SIZE, now: 320 });
  });

  test("reports the clamped position when the remembered size no longer fits", () => {
    assert.deepEqual(treeSizeRangeOf(320, 375), { min: MIN_TREE_SIZE, max: 215, now: 215 });
  });

  test("pins every value to the tree minimum when the container is too small for both panes", () => {
    assert.deepEqual(treeSizeRangeOf(320, 200), { min: MIN_TREE_SIZE, max: MIN_TREE_SIZE, now: MIN_TREE_SIZE });
  });

  test("keeps the position within whole-pixel bounds for fractional containers", () => {
    assert.deepEqual(treeSizeRangeOf(900, 639.5), { min: MIN_TREE_SIZE, max: 479, now: 479 });
  });
});

describe("treeSizeAfterKey", () => {
  test("moves a vertical divider with the left and right arrows", () => {
    assert.equal(treeSizeAfterKey("ArrowRight", "row", 300, 900), 316);
    assert.equal(treeSizeAfterKey("ArrowLeft", "row", 300, 900), 284);
    assert.equal(treeSizeAfterKey("ArrowDown", "row", 300, 900), null);
  });

  test("moves a horizontal divider with the up and down arrows", () => {
    assert.equal(treeSizeAfterKey("ArrowDown", "column", 300, 900), 316);
    assert.equal(treeSizeAfterKey("ArrowUp", "column", 300, 900), 284);
    assert.equal(treeSizeAfterKey("ArrowRight", "column", 300, 900), null);
  });

  test("jumps to either end with Home and End", () => {
    assert.equal(treeSizeAfterKey("Home", "row", 300, 900), MIN_TREE_SIZE);
    assert.equal(treeSizeAfterKey("End", "row", 300, 900), 900 - MIN_VIEWER_SIZE);
  });

  test("stops at the limits", () => {
    assert.equal(treeSizeAfterKey("ArrowLeft", "row", MIN_TREE_SIZE, 900), MIN_TREE_SIZE);
  });

  test("ignores other keys", () => {
    assert.equal(treeSizeAfterKey("Enter", "row", 300, 900), null);
  });
});
