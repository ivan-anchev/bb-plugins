import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cli } from "../host-command.ts";
import { glabSignIn } from "./sign-in.ts";

const HOST = "gitlab.corp.test";

/** glab's `auth status` answering with `stdout`, or rejecting as Node's execFile does with `failure`. */
const glab =
  (answer: { stdout: string } | { failure: object }) =>
  async (cli: Cli, args: string[]): Promise<string> => {
    assert.deepEqual([cli, ...args], ["glab", "auth", "status", "--hostname", HOST, "--output", "json"]);
    if ("failure" in answer) throw Object.assign(new Error("Command failed: glab auth status"), answer.failure);
    return answer.stdout;
  };

/** glab's JSON for the host, as 1.131.0 prints it (review.md). */
const status = (state: string, error = "") => JSON.stringify({ hosts: [{ host: HOST, state, user: "ivan", error, token_source: "keyring", api_endpoint: `https://${HOST}/api/v4/`, graphql_endpoint: `https://${HOST}/api/graphql/` }] });
/** An `auth status` that exited 1 with this on stdout and stderr. */
const exited = (stdout: string, stderr = "") => ({ failure: { code: 1, stdout, stderr } });
const refusal = async (answer: Parameters<typeof glab>[0]) => {
  const signIn = await glabSignIn(glab(answer), HOST);
  return signIn.kind === "refused" ? signIn.unavailable : assert.fail("signed in");
};

test("sign-in: glab signed in to the host, its entry reading success, signs it in; any other answer doesn't", async () => {
  assert.deepEqual(await glabSignIn(glab({ stdout: status("success") }), HOST), { kind: "signed-in" });
  assert.deepEqual(await refusal({ stdout: JSON.stringify({ hosts: [{ host: "gitlab.com", state: "success" }] }) }), {
    kind: "persistent",
    forge: null,
    reason: `${HOST} isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname ${HOST} there`,
  });
  assert.equal((await refusal({ stdout: "Logged in" })).kind, "persistent", "an answer that isn't glab's JSON signs nothing in");
  assert.equal((await refusal(exited(status("error", `${HOST} has not been authenticated with glab`)))).forge, null, "a host glab has no sign-in for, worded as an entry");
});

test("sign-in: a host glab doesn't know, a missing glab and a glab older than 1.122 each last, naming the host, on no forge yet", async () => {
  const cases: [string, Parameters<typeof glab>[0], string][] = [
    ["a host glab doesn't know", exited("", `x ${HOST} has not been authenticated with glab; run \`glab auth login --hostname ${HOST}\` to authenticate\n`), `${HOST} isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname ${HOST} there`],
    ["glab missing", { failure: { code: "ENOENT" } }, `${HOST} isn't github.com, and glab, the GitLab CLI, isn't installed on the machine running bb: if ${HOST} is a GitLab, install glab there and run glab auth login --hostname ${HOST}`],
    ["glab older than 1.122", exited("", "Error: unknown flag: --output\n"), `glab on the machine running bb is older than 1.122, which reading GitLab at ${HOST} needs: update it there`],
  ];
  for (const [name, answer, reason] of cases) assert.deepEqual(await refusal(answer), { kind: "persistent", forge: null, reason }, name);
});

test("sign-in: a check glab ran that failed is GitLab's: rejected credentials and any other failure last; a connection that never answered may pass", async () => {
  const cases: [string, Parameters<typeof glab>[0], "persistent" | "transient", string][] = [
    ["credentials rejected", exited(status("error", `GET https://${HOST}/api/v4/user: 401 {message: 401 Unauthorized}`)), "persistent", `GitLab at ${HOST} rejected glab's credentials (HTTP 401): run glab auth login --hostname ${HOST} on the machine running bb`],
    ["sign-in failed", exited(status("error", `the token for "${HOST}" is missing from the operating system keyring`)), "persistent", `glab's sign-in to ${HOST} failed on the machine running bb: run glab auth login --hostname ${HOST} there`],
    ["a transport error in the status JSON", exited(status("error", `Get "https://${HOST}/api/v4/user": dial tcp: lookup ${HOST}: no such host`)), "transient", `couldn't reach GitLab at ${HOST}`],
    ["a transport error on stderr", exited("", `Get "https://${HOST}/api/v4/user": net/http: TLS handshake timeout\n`), "transient", `couldn't reach GitLab at ${HOST}`],
  ];
  for (const [name, answer, kind, reason] of cases) assert.deepEqual(await refusal(answer), { kind, forge: "gitlab", reason }, name);
});

test("sign-in: a check glab never finished may pass, naming the host", async () => {
  assert.deepEqual(await refusal({ failure: { code: null, killed: true } }), { kind: "transient", forge: null, reason: `glab didn't answer whether it is signed in to ${HOST} on the machine running bb` });
});
