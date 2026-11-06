import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGitHubRepo } from "./repo.ts";

const cases: [remote: string, repo: string | null][] = [
  ["git@github.com:ivan-anchev/bb-plugins.git", "ivan-anchev/bb-plugins"],
  ["git@github.com:ivan-anchev/bb-plugins", "ivan-anchev/bb-plugins"],
  ["ssh://git@github.com/ivan-anchev/bb-plugins", "ivan-anchev/bb-plugins"],
  ["ssh://git@github.com/ivan-anchev/bb-plugins.git", "ivan-anchev/bb-plugins"],
  ["https://github.com/ivan-anchev/bb-plugins", "ivan-anchev/bb-plugins"],
  ["https://github.com/ivan-anchev/bb-plugins.git", "ivan-anchev/bb-plugins"],
  ["https://github.com/ivan-anchev/bb-plugins/", "ivan-anchev/bb-plugins"],
  ["https://github.com/ivan-anchev/bb-plugins.git/", "ivan-anchev/bb-plugins"],
  ["https://ivan@github.com/ivan-anchev/bb-plugins.git", "ivan-anchev/bb-plugins"],
  ["https://github.com/get-bb/plugin.sdk.git", "get-bb/plugin.sdk"],
  ["git@gitlab.com:ivan-anchev/bb-plugins.git", null],
  ["https://example.com/github.com/ivan-anchev/bb-plugins", null],
  ["https://github.com/ivan-anchev", null],
];

for (const [remote, repo] of cases) {
  test(`parseGitHubRepo(${remote}) is ${repo}`, () => {
    assert.equal(parseGitHubRepo(remote), repo);
  });
}
