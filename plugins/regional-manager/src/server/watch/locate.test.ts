import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cli } from "./host-command.ts";
import { createLocator } from "./locate.ts";

/** glab signed in to `hosts` and no other, as `auth status --output json` answers; gh never runs here. Every run's arguments, in order. */
function glabSignedIn(...hosts: string[]) {
  const runs: string[][] = [];
  const run = async (cli: Cli, args: string[]) => {
    assert.equal(cli, "glab", "locating never runs gh");
    runs.push(args);
    const host = args[3] ?? "";
    if (!hosts.includes(host)) throw Object.assign(new Error("Command failed: glab auth status"), { code: 1, stdout: "", stderr: `x ${host} has not been authenticated with glab; run \`glab auth login --hostname ${host}\` to authenticate\n` });
    return JSON.stringify({ hosts: [{ host, state: "success", user: "ivan", token_source: "keyring" }] });
  };
  return { run, runs };
}

test("a github.com remote in every shape git writes is GitHub's owner/name, and asks glab nothing", async () => {
  const glab = glabSignedIn();
  const { locate } = createLocator(glab.run);
  for (const remote of ["git@github.com:acme/webhooks.git", "ssh://git@github.com/acme/webhooks", "https://x-access-token:tok@github.com/acme/webhooks.git/", "git://github.com/acme/webhooks.git", "https://GitHub.com/acme/webhooks"]) {
    assert.deepEqual(await locate(remote), { kind: "on-forge", repo: { forge: "github", host: "github.com", path: "acme/webhooks" } }, remote);
  }
  assert.deepEqual(glab.runs, []);
});

test("a remote on a host glab is signed in to is GitLab's, the ssh port and userinfo dropped, any depth of group kept; glab is asked once for the plugin's life", async () => {
  const glab = glabSignedIn("gitlab.corp.test", "git.corp");
  const { locate } = createLocator(glab.run);
  const stationWs = { kind: "on-forge", repo: { forge: "gitlab", host: "gitlab.corp.test", path: "frontend/station-ws" } };
  assert.deepEqual(await locate("ssh://git@gitlab.corp.test:8022/frontend/station-ws.git"), stationWs);
  assert.deepEqual(await locate("ssh://git@gitlab.corp.test:8022/frontend/station-ws.git"), stationWs);
  assert.deepEqual(await locate("git@git.corp:group/sub/proj.git"), { kind: "on-forge", repo: { forge: "gitlab", host: "git.corp", path: "group/sub/proj" } });
  assert.deepEqual(await locate("https://oauth2:glpat-secret@git.corp/group/proj.git"), { kind: "on-forge", repo: { forge: "gitlab", host: "git.corp", path: "group/proj" } });
  assert.deepEqual(glab.runs, [
    ["auth", "status", "--hostname", "gitlab.corp.test", "--output", "json"],
    ["auth", "status", "--hostname", "git.corp", "--output", "json"],
  ]);
});

test("a host glab isn't signed in to is off every forge, named in the reason with no remote's userinfo, and asked again on the next locate", async () => {
  const glab = glabSignedIn();
  const { locate } = createLocator(glab.run);
  const offForge = { kind: "off-forge", unavailable: { kind: "persistent", forge: null, reason: "gitlab.com isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname gitlab.com there" } };
  assert.deepEqual(await locate("https://user:secret@gitlab.com/acme/webhooks.git"), offForge);
  assert.deepEqual(await locate("https://user:secret@gitlab.com/acme/webhooks.git"), offForge);
  assert.equal(glab.runs.length, 2, "a refused sign-in is never remembered");
});

test("forgetting a host asks glab about it again on the next locate", async () => {
  const glab = glabSignedIn("gitlab.corp.test");
  const { locate, forget } = createLocator(glab.run);
  await locate("ssh://git@gitlab.corp.test:8022/frontend/station-ws.git");
  forget("gitlab.corp.test");
  await locate("ssh://git@gitlab.corp.test:8022/frontend/station-ws.git");
  assert.equal(glab.runs.length, 2);
});

test("a remote the plugin can't read says why, naming at most its host, never its userinfo or the whole remote", async () => {
  const glab = glabSignedIn("git.corp.test");
  const { locate } = createLocator(glab.run);
  const reasonOf = async (remote: string) => {
    const located = await locate(remote);
    return located.kind === "off-forge" ? located.unavailable : assert.fail(`${remote} was located`);
  };
  const ported = await reasonOf("https://user:secret@git.corp.test:8443/g/p.git");
  assert.deepEqual(ported, { kind: "persistent", forge: null, reason: "its project's git remote on git.corp.test names a port, which the plugin doesn't read" });
  assert.ok(!ported.reason.includes("secret") && !ported.reason.includes("user"));
  for (const remote of ["https://gitlab.corp.test:443/g/p.git", "http://user:secret@git.corp.test:80/g/p.git", "https://git.corp.test:/g/p.git"]) {
    assert.match((await reasonOf(remote)).reason, /^its project's git remote on git(lab)?\.corp\.test names a port, which the plugin doesn't read$/, `${remote}: a default port is still a port`);
  }
  assert.deepEqual(await locate(null), { kind: "no-remote", unavailable: { kind: "persistent", forge: null, reason: "its project has no git remote" } });
  for (const remote of ["/Users/ivan/repos/webhooks", "file:///srv/git/webhooks.git", "https://user:secret@git.corp.test/%zz/p.git"]) {
    assert.deepEqual(await reasonOf(remote), { kind: "persistent", forge: null, reason: "its project's git remote isn't one the plugin can read" }, remote);
  }
  assert.deepEqual(await reasonOf("https://github.com/acme/team/webhooks.git"), { kind: "persistent", forge: null, reason: "its project's git remote on github.com names no owner/name repository" });
  assert.deepEqual(glab.runs, [], "none of them asks glab");
});
