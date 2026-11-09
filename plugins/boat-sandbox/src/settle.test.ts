import assert from "node:assert/strict";
import { test } from "node:test";
import { BoatApiError } from "./boat/client.ts";
import { settle } from "./settle.ts";

const refused = (code: string) => Promise.reject(new BoatApiError(403, code, `boat says ${code}.`, null, false));

test("a 403 reads from boat's error code: a missing scope, an expired key, or boat's own words", async () => {
  assert.deepEqual(await settle(refused("api_key_action_forbidden"), "account.admin"), { ok: false, reason: "the API key lacks boat's account.admin scope" });
  assert.deepEqual(await settle(refused("api_key_expired"), "account.admin"), { ok: false, reason: "the API key has expired" });
  assert.deepEqual(await settle(refused("api_key_sandbox_forbidden"), "account.admin"), { ok: false, reason: "boat says api_key_sandbox_forbidden." });
});

test("a missing scope with no scope named reads in boat's words, and `elsewhere` follows any reason", async () => {
  assert.deepEqual(await settle(refused("api_key_action_forbidden")), { ok: false, reason: "boat says api_key_action_forbidden." });
  assert.deepEqual(await settle(Promise.reject(new Error("bb is restarting.")), undefined, "`bb status` shows it"), {
    ok: false,
    reason: "bb is restarting.; `bb status` shows it",
  });
  assert.deepEqual(await settle(Promise.resolve(1)), { ok: true, value: 1 });
});
