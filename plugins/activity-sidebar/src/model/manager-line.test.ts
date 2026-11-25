import assert from "node:assert/strict";
import { test } from "node:test";
import { firstSentence, namingThreads } from "./manager-line.ts";

test("the first sentence ends at '. ', '! ' or '? ', keeping its mark", () => {
  assert.equal(firstSentence("BBP-3 is running now. BBP-6 waits on it."), "BBP-3 is running now.");
  assert.equal(firstSentence("Done! The PR is open."), "Done!");
  assert.equal(firstSentence("Merge it? It passed every check."), "Merge it?");
  assert.equal(firstSentence("Version 0.10.0 is out"), "Version 0.10.0 is out", "a dot inside a word ends nothing");
});

test("a line break ends the sentence; blank lines before it are skipped", () => {
  assert.equal(firstSentence("\n\nThe review is back\nwith two findings."), "The review is back");
});

test("markdown is stripped: links keep their text, code blocks go, emphasis, code and heading marks go", () => {
  assert.equal(firstSentence("I've filed it as [BBP-6](/plugins/regional-manager/issue/BBP-6). It starts next."), "I've filed it as BBP-6.");
  assert.equal(firstSentence("See [the PR](https://example.org/wiki/A_(B)). Next."), "See the PR.", "a destination with balanced parentheses");
  assert.equal(firstSentence('Read [the notes](<docs/a b.md> "Notes") and ![a chart](c.png). Then go.'), "Read the notes and a chart.");
  assert.equal(firstSentence("```ts\nconst a = 1;\n```\nThe fix is in."), "The fix is in.");
  assert.equal(firstSentence("## Status\n\nAll green."), "Status");
  assert.equal(firstSentence("**Two** issues _need_ you, see `npm run check` and ~~none~~ else."), "Two issues need you, see npm run check and none else.");
  assert.equal(firstSentence("- **First:** the row.\n- Second."), "First: the row.");
  assert.equal(firstSentence("> Quoted. Rest."), "Quoted.");
  assert.equal(firstSentence("snake_case_names stay whole, as does 2*3*4."), "snake_case_names stay whole, as does 2*3*4.");
});

test("whitespace collapses to single spaces", () => {
  assert.equal(firstSentence("  Three   managers\tare open.  "), "Three managers are open.");
});

test("a reply with nothing readable has no sentence", () => {
  assert.equal(firstSentence(""), null);
  assert.equal(firstSentence("   \n\n"), null);
  assert.equal(firstSentence("```\nonly code\n```"), null);
  assert.equal(firstSentence("---"), null);
});

test("a bb thread mention reads as the thread's title, or as a thread the sidebar doesn't hold", () => {
  const titles: Record<string, string> = { thr_yy5n7jt7zj: "Managers' Manager" };
  assert.equal(namingThreads("Waiting on the board of @thread:thr_yy5n7jt7zj.", (id) => titles[id]), "Waiting on the board of Managers' Manager.");
  assert.equal(namingThreads("See @thread:thr_gone#msg=42 for it.", (id) => titles[id]), "See a thread for it.");
});
