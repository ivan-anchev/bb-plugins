import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import type { BoatClient } from "./boat/client.ts";
import { accountId, wireSavedSnapshotList, type SavedSnapshot } from "./boat/wire.ts";
import { boatCli } from "./cli.ts";
import { problem } from "./problem.ts";

/** tpl-test and tpl-noenv, as boat listed them live (ids redacted). */
const SAVED = wireSavedSnapshotList.parse(JSON.parse(readFileSync(new URL("./boat/fixtures/saved-snapshots.json", import.meta.url), "utf8")));
const FAILED: SavedSnapshot = { name: "py-ml", status: "failed", error: "source sandbox was deleted", savedFrom: null, savedAt: "2026-11-09T11:02:00.000Z" };

const unused = () => Promise.reject(new Error("the command never calls this"));

function cliWith(defaultTemplate: string | null, savedSnapshots: BoatClient["savedSnapshots"] = async () => [...SAVED, FAILED]) {
  const client: BoatClient = {
    savedSnapshots,
    me: unused,
    limits: unused,
    get: unused,
    list: unused,
    create: unused,
    remove: unused,
    stop: unused,
    resume: unused,
    setTtl: unused,
    run: unused,
    writeFile: unused,
  };
  const session: BoatSession = {
    status: "available",
    facts: {
      account: { id: accountId.parse("sandbox_1"), login: "octocat", zeroDataRetention: false },
      limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null },
    },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: null, defaults: { template: defaultTemplate, preset: "default" } },
  };
  return cli({ configuration: async () => session, session: async () => session });
}

const cli = (access: BoatAccess) =>
  boatCli(access, { bb: { sdk: { hosts: { list: unused }, threads: { count: unused } }, experimental_machines: { getResource: unused } }, idle: { read: unused }, ownerId: "owner-1" });

test("bb boat templates lists the stock image and every saved snapshot with its --machine-inputs and the default launch", async () => {
  const { exitCode, stdout } = await cliWith("tpl-test").run(["templates"], {});

  assert.equal(exitCode, 0);
  assert.equal(
    stdout,
    [
      "TEMPLATE          STATUS  SIZE   SAVED              --machine-inputs          NOTES",
      'boat stock image  ready   -      -                  {"template":null}',
      'tpl-test          ready   small  2026-11-09T09:50Z  {"template":"tpl-test"}   default',
      'tpl-noenv         ready   small  2026-11-09T09:49Z  {"template":"tpl-noenv"}',
      "py-ml             failed  -      2026-11-09T11:02Z  -                         source sandbox was deleted",
      "",
      "Default launch (Settings → boat Sandbox): a default boat sandbox from template tpl-test.",
      "  bb thread spawn --project <project-id> --environment-provider boat-sandbox \\",
      `    --machine-inputs '{"template":"tpl-test","preset":"default"}' --prompt "…"`,
      "Save a template from any boat sandbox with: boat snapshot <sandbox-id> <name>",
      "",
    ].join("\n"),
  );
});

test("bb boat templates --json prints the launch choices", async () => {
  const { stdout } = await cliWith(null).run(["templates", "--json"], {});

  assert.deepEqual(JSON.parse(stdout ?? ""), { templates: [...SAVED, FAILED], defaults: { template: null, preset: "default" } });
});

test("bb boat templates exits 1 with the status problem lines when the key does not work", async () => {
  const missing: Configuration = { status: "setup-required", facts: null, problems: [problem("No boat API key is set.", "Paste one")] };
  const access: BoatAccess = { configuration: async () => missing, session: unused };

  const { exitCode, stdout } = await cli(access).run(["templates"], {});

  assert.equal(exitCode, 1);
  assert.equal(stdout, "No boat API key is set.\nFix: Paste one, then run `bb plugin reload boat-sandbox`.\n");
});

test("bb boat status names the default launch, and refuses a Default template boat does not have, with a fix", async () => {
  const lastLines = async (defaultTemplate: string | null) => {
    const { exitCode, stdout } = await cliWith(defaultTemplate).run(["status"], {});
    return { exitCode, lines: (stdout ?? "").trimEnd().split("\n").slice(5) };
  };

  assert.deepEqual(await lastLines(null), { exitCode: 0, lines: ["Default launch: a default boat sandbox from boat's stock image"] });
  assert.deepEqual(await lastLines("tpl-test"), { exitCode: 0, lines: ["Default launch: a default boat sandbox from template tpl-test"] });
  const stale = await lastLines("gone");
  assert.equal(stale.exitCode, 0);
  assert.equal(stale.lines[0], 'Default launch: refused: No saved snapshot "gone" on this boat account (Settings → boat Sandbox → Default template). Run `bb boat templates` to list them.');
  assert.match(stale.lines[1] ?? "", /^Fix: Run `bb plugin config boat-sandbox set defaultTemplate <name>`.*unset defaultTemplate/);
});

test("bb boat status reads the default launch as unknown when boat cannot list the snapshots", async () => {
  const { exitCode, stdout } = await cliWith("tpl-test", async () => Promise.reject(new Error("the API key lacks snapshot.read"))).run(["status"], {});

  assert.equal(exitCode, 0);
  assert.match(stdout ?? "", /\nDefault launch: unknown \(the API key lacks snapshot\.read\)\n$/);
});
