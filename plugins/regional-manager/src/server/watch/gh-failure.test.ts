import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ghFailure } from "./gh-failure.ts";
import { parseHostCommandFailure } from "./host-command.ts";

// Each fixture is the rejection of a real gh run, saved field for field. not-signed-in,
// bad-credentials-401 and network ran this watch's own query against ivan-anchev/bb-plugins with
// gh 2.97.0: with no token and an empty config, with a token GitHub refuses, and through a proxy
// that refuses every connection. not-installed, network-eof and timed-out are pr-reviews'
// recordings (its fixtures/gh-failures): the same failures of the same gh, from other commands.
const recorded = (name: string) => ghFailure(parseHostCommandFailure(JSON.parse(readFileSync(new URL(`./fixtures/gh-failures/${name}.json`, import.meta.url), "utf8"))));

const failed = (stderr: string) => ghFailure({ code: 1, stdout: "", stderr: `${stderr}\n`, killed: false });

const persistent = (reason: string) => ({ kind: "persistent", reason });
const transient = (reason: string) => ({ kind: "transient", reason });

test("gh missing, and gh signed out, each say so and last; a token GitHub refuses says it was rejected, not that gh is signed out", () => {
  assert.deepEqual(recorded("not-installed"), persistent("gh, the GitHub CLI, isn't installed on the machine running bb"));
  assert.deepEqual(recorded("not-signed-in"), persistent("gh isn't signed in on the machine running bb: run gh auth login there"));
  assert.deepEqual(recorded("bad-credentials-401"), persistent("GitHub rejected gh's credentials on the machine running bb (HTTP 401): check gh auth status there"));
});

test("every recorded transport failure reads as a connection that never answered, never as gh's raw text, and may pass", () => {
  for (const name of ["network", "network-eof", "timed-out"]) assert.deepEqual(recorded(name), transient("couldn't reach GitHub"), name);
});

test("each class of transport failure Go reports reads as a connection that never answered", () => {
  // Go's own error texts, as gh prints them after the request it made.
  const post = 'Post "https://api.github.com/graphql": ';
  const cases: [string, string][] = [
    ["gh's own", "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com"],
    ["a bare EOF", `${post}EOF`],
    ["an unexpected EOF", `${post}unexpected EOF`],
    ["the request's deadline", `${post}context deadline exceeded (Client.Timeout exceeded while awaiting headers)`],
    ["the dial's timeout", `${post}dial tcp 140.82.112.6:443: i/o timeout`],
    ["the TLS handshake's timeout", `${post}net/http: TLS handshake timeout`],
    ["an unknown certificate authority", `${post}tls: failed to verify certificate: x509: certificate signed by unknown authority`],
    ["an expired certificate", `${post}x509: certificate has expired or is not yet valid: current time 2026-11-16T10:00:00Z is after 2026-11-01T00:00:00Z`],
    ["a TLS alert", `${post}remote error: tls: handshake failure`],
    ["a refused connection", `${post}dial tcp 140.82.112.6:443: connect: connection refused`],
    ["a reset connection", `${post}read tcp 10.0.0.2:51234->140.82.112.6:443: read: connection reset by peer`],
    ["no route", `${post}dial tcp 140.82.112.6:443: connect: no route to host`],
    ["an unknown host", `${post}dial tcp: lookup api.github.com: no such host`],
    ["a failing resolver", `${post}dial tcp: lookup api.github.com on 127.0.0.53:53: server misbehaving`],
  ];
  for (const [name, stderr] of cases) assert.deepEqual(failed(stderr), transient("couldn't reach GitHub"), name);
});

test("a rate limit, and any other failure, may pass; any other failure is gh's own first line, without its prefix", () => {
  assert.deepEqual(failed("gh: API rate limit exceeded for user (HTTP 403)"), transient("GitHub is limiting requests right now"));
  assert.deepEqual(failed("gh: Could not resolve to a Repository with the name 'octo-org/gone'."), transient("Could not resolve to a Repository with the name 'octo-org/gone'."));
  assert.deepEqual(failed("gh: Something went wrong while executing your query. (HTTP 502)"), transient("Something went wrong while executing your query. (HTTP 502)"), "an answer that isn't a transport failure stays gh's");
  assert.deepEqual(ghFailure({ code: 2, stdout: "", stderr: "", killed: false }), transient("gh failed with no message (exit 2)"));
});
