import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SKILLS = join(import.meta.dirname, "..", "skills");

// why: bb skips a skill whose front matter it can't read, and configure() then fails on selecting
// it, so every thread loses its tools. Each field is one plain YAML line: ": " or " #" inside one
// ends it early, and bb refuses a description past 1,024 characters.
test("every skill's name and description are plain one-line YAML that bb reads, the description within 1,024 characters", () => {
  for (const skill of readdirSync(SKILLS)) {
    const text = readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8");
    for (const field of ["name", "description"]) {
      const value = new RegExp(`^${field}: (.*)$`, "m").exec(text)?.[1];
      assert.ok(value !== undefined && !value.includes(": ") && !value.includes(" #"), `${skill}: ${field} is not one plain YAML line`);
    }
    assert.equal(/^name: (.*)$/m.exec(text)?.[1], skill);
    const description = /^description: (.*)$/m.exec(text)?.[1] ?? "";
    assert.ok(description.length <= 1024, `${skill}: the description has ${description.length} characters`);
  }
});

const GH = /\bgh\b/;
const GLAB = /\bglab\b/;
// A pull request named any way a skill names one, or the CLI that reaches it.
const CHANGE_REQUEST = /pull requests?|\bPRs?\b|\bCLI\b/;

// why: a GitLab project's agents, verifiers and managers read these skills too, and a line that
// sends them to gh alone for a pull request would have them reach a merge request with the wrong CLI.
test("no skill line names `gh` as the way to reach a pull request without naming `glab` beside it", () => {
  for (const skill of readdirSync(SKILLS)) {
    const lines = readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      if (GH.test(line) && CHANGE_REQUEST.test(line)) assert.match(line, GLAB, `${skill}/SKILL.md:${i + 1} names gh for a pull request without glab`);
    }
  }
});
