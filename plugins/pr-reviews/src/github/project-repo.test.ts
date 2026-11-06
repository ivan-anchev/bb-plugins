import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { projectRepo } from "./project-repo.ts";

// Real checkouts in a temp dir, read through real git.
const root = mkdtempSync(join(tmpdir(), "pr-reviews-project-repo-"));
after(() => rmSync(root, { recursive: true, force: true }));

function checkout(name: string, setup: (path: string) => void = () => {}): string {
  const path = join(root, name);
  mkdirSync(path);
  setup(path);
  return path;
}
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args]);
const gitRepo = (path: string) => git(path, "init", "--quiet");

const withRemote = (gitRemoteUrl: string) => ({ gitRemoteUrl, sources: [] });
const withCheckout = (path: string) => ({ gitRemoteUrl: null, sources: [{ path: join(root, "other"), isDefault: false }, { path, isDefault: true }] });

test("bb's recorded remote is used as is", async () => {
  assert.deepEqual(await projectRepo(withRemote("git@github.com:ivan-anchev/bb-plugins.git")), { kind: "github", repo: "ivan-anchev/bb-plugins" });
  assert.deepEqual(await projectRepo(withRemote("git@gitlab.com:ivan-anchev/bb-plugins.git")), { kind: "none" });
});

test("without a recorded remote, the default checkout's origin is read", async () => {
  const github = checkout("github", (path) => {
    gitRepo(path);
    git(path, "remote", "add", "origin", "https://github.com/ivan-anchev/bb-plugins.git");
  });
  const gitlab = checkout("gitlab", (path) => {
    gitRepo(path);
    git(path, "remote", "add", "origin", "https://gitlab.com/ivan-anchev/bb-plugins.git");
  });
  assert.deepEqual(await projectRepo(withCheckout(github)), { kind: "github", repo: "ivan-anchev/bb-plugins" });
  assert.deepEqual(await projectRepo(withCheckout(gitlab)), { kind: "none" });
});

test("a project with no origin to read has no repo", async (t) => {
  const absent: [string, { gitRemoteUrl: null; sources: { path: string; isDefault: boolean }[] }][] = [
    ["no default checkout", { gitRemoteUrl: null, sources: [{ path: root, isDefault: false }] }],
    ["the checkout's path is gone", withCheckout(join(root, "deleted"))],
    ["the checkout is not a git repository", withCheckout(checkout("plain"))],
    ["the checkout has no origin", withCheckout(checkout("no-origin", gitRepo))],
  ];
  for (const [name, project] of absent) {
    await t.test(name, async () => assert.deepEqual(await projectRepo(project), { kind: "none" }));
  }
});

test("any other git failure is reported, not read as absence", async (t) => {
  await t.test("a broken config", async () => {
    const broken = checkout("broken-config", (path) => {
      gitRepo(path);
      writeFileSync(join(path, ".git", "config"), '[remote "origin"\n');
    });
    const read = await projectRepo(withCheckout(broken));
    assert.equal(read.kind, "unreadable");
    assert.match(read.message, /^fatal: bad config line \d+ in file \.git\/config$/);
  });

  await t.test("a checkout git may not enter", async (t) => {
    const locked = checkout("locked", (path) => chmodSync(path, 0o000));
    t.after(() => chmodSync(locked, 0o755));
    assert.deepEqual(await projectRepo(withCheckout(locked)), { kind: "unreadable", message: `fatal: cannot change to '${locked}': Permission denied` });
  });
});
