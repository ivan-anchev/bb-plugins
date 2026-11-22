import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { freshStore, MANAGER } from "../store/test-store.ts";
import { openMemoryRoot } from "./memory-files.ts";
import { reportFileOf, storeReport } from "./report-file.ts";

const I1 = issueIdSchema.parse("WEB-1");

test("a report whose handoff fails to store leaves the file as someone changed it meanwhile, not as it was before", () => {
  const files = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-report-")), "data.db"), freshStore().store, () => {}).of(MANAGER);
  const store = () =>
    storeReport(files, I1, [], "## Vault", (file) => {
      const { version } = files.read(file).text ?? assert.fail("the report was not saved before its handoff");
      files.write(file, "# My notes\n", version);
      throw new Error("forced failure");
    });
  assert.throws(store, /forced failure/);
  assert.equal(files.read(reportFileOf(I1)).text?.content, "# My notes\n");
});
