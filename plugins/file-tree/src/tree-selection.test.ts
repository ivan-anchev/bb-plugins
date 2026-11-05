import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FileTree } from "@pierre/trees";
import { keepOnlySelected } from "./tree-selection.ts";

const paths = Array.from({ length: 2500 }, (_, index) => `src/file-${index}.ts`);

describe("keepOnlySelected", () => {
  test("narrows thousands of selected files back to the selected file", () => {
    const model = new FileTree({ paths, initialSelectedPaths: paths });

    keepOnlySelected(model, "src/file-7.ts");

    assert.deepEqual(model.getSelectedPaths(), ["src/file-7.ts"]);
  });

  test("keeps the selected file when the user selects another one", () => {
    const model = new FileTree({ paths });
    keepOnlySelected(model, "src/file-7.ts");

    model.getItem("src/file-9.ts")?.select();

    assert.deepEqual(model.getSelectedPaths(), ["src/file-7.ts"]);
  });
});
