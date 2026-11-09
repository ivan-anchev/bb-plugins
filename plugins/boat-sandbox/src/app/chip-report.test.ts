import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxEnvironment, SavedSnapshot } from "../boat/wire.ts";
import type { LaunchChoicesReply } from "../contract.ts";
import type { LaunchDefaults } from "../launch.ts";
import { chipView, pick, type ChoicesQuery } from "./chip-report.ts";

const template = (name: string, status: SavedSnapshot["status"] = "ready"): SavedSnapshot => ({
  name,
  status,
  error: status === "failed" ? "source sandbox was deleted" : null,
  savedFrom: "default",
  savedAt: "2026-11-09T10:12:00.000Z",
});

const environment = (name: string, isBoatDefault = false): SandboxEnvironment => ({
  name,
  isBoatDefault,
  withholdsAll: false,
  proxiesAi: false,
  passes: { agents: true, github: true, secrets: false },
  profileId: null,
});

const ready = (defaults: Partial<LaunchDefaults> = {}): LaunchChoicesReply => ({
  status: "ready",
  templates: [template("node-tools"), template("py-ml", "saving"), template("old", "failed")],
  environments: [environment("base", true), environment("qa")],
  defaults: { template: "node-tools", environment: null, preset: "default", ...defaults },
});

const LOADING: ChoicesQuery = { data: undefined, error: null };
const loaded = (defaults: Partial<LaunchDefaults> = {}): ChoicesQuery => ({ data: ready(defaults), error: null });
/** The last read failed; `retained` is what an earlier read loaded. */
const failed = (message: string, retained?: LaunchChoicesReply): ChoicesQuery => ({ data: retained, error: new Error(message) });

const choicesOf = ({ data }: ChoicesQuery) => {
  assert.ok(data?.status === "ready");
  return data;
};

test("before the list loads, the chip reports the value as it stands, so submit is enabled", () => {
  const view = chipView({}, LOADING);

  assert.deepEqual(view, { report: { status: "ready", value: {} }, label: "boat sandbox", problem: null, launch: null });
  assert.deepEqual(chipView(null, LOADING).report, { status: "ready", value: {} });
  assert.deepEqual(chipView({ preset: "large" }, LOADING).report, { status: "ready", value: { preset: "large" } });
});

test("a value that does not parse counts as no choice, so nothing outside the three names is reported", () => {
  assert.deepEqual(chipView({ apiKey: "boat_secret" }, LOADING).report, { status: "ready", value: {} });
  assert.deepEqual(chipView({ template: "node-tools", token: "x" }, loaded()).report, {
    status: "ready",
    value: { template: "node-tools", environment: "base", preset: "default" },
  });
});

test("loaded, the chip shows the settings' defaults and reports them as the explicit triple", () => {
  const view = chipView({}, loaded());

  assert.equal(view.label, "node-tools · base · default");
  assert.equal(view.problem, null);
  assert.deepEqual(view.report, { status: "ready", value: { template: "node-tools", environment: "base", preset: "default" } });
  assert.deepEqual(view.launch, { template: "node-tools", environment: "base", preset: "default" });
});

test("boat's stock image reads as `stock image` in the label and null in the inputs", () => {
  const view = chipView({ template: null, environment: "qa", preset: "small" }, loaded());

  assert.equal(view.label, "stock image · qa · small");
  assert.deepEqual(view.report, { status: "ready", value: { template: null, environment: "qa", preset: "small" } });
});

test("a Default template boat no longer has blocks submit with validate's message", () => {
  const view = chipView({}, loaded({ template: "nope" }));

  assert.equal(view.label, "nope");
  const reason = 'No saved snapshot "nope" on this boat account (Settings → boat Sandbox → Default template). Run `bb boat templates` to list them.';
  assert.deepEqual(view.report, { status: "blocked", reason });
  assert.equal(view.problem, reason);
  assert.equal(view.launch, null);
});

test("a saving or failed template, or an environment boat does not have, blocks with the refused name", () => {
  const saving = chipView({ template: "py-ml" }, loaded());
  assert.equal(saving.label, "py-ml");
  assert.equal(saving.report.status, "blocked");

  const failed = chipView({ template: "old" }, loaded());
  assert.equal(failed.label, "old");
  assert.match(failed.problem ?? "", /boat could not save template "old": source sandbox was deleted/);

  const gone = chipView({ environment: "demos" }, loaded());
  assert.equal(gone.label, "demos");
  assert.deepEqual(gone.report, { status: "blocked", reason: 'boat has no environment "demos". Run `bb boat templates` to list them.' });
});

test("with no usable key the chip reads `boat: set up` and blocks with the provider's message", () => {
  const message = "No boat API key is set. Paste one into Settings → boat Sandbox → API key, then run `bb plugin reload boat-sandbox`.";
  const reply: LaunchChoicesReply = { status: "unavailable", message };

  const view = chipView({}, { data: reply, error: null });

  assert.deepEqual(view, { report: { status: "blocked", reason: message }, label: "boat: set up", problem: message, launch: null });
});

test("a failed first read shows the error but never blocks", () => {
  const view = chipView({ template: "node-tools" }, failed("boat timed out"));

  assert.deepEqual(view, {
    report: { status: "ready", value: { template: "node-tools" } },
    label: "boat: list failed",
    problem: "Could not list boat templates: boat timed out",
    launch: null,
  });
});

test("a refresh that fails after a valid read reports the value as it stands, with the error next to the retained launch", () => {
  const value = { template: "node-tools", environment: "qa", preset: "small" };

  const view = chipView(value, failed("boat timed out", ready()));

  assert.deepEqual(view, {
    report: { status: "ready", value },
    label: "node-tools · qa · small",
    problem: "Could not list boat templates: boat timed out",
    launch: value,
  });
});

test("a refresh that fails after a refused read stops blocking: the earlier refusal is no longer known", () => {
  const stale = chipView({}, failed("boat timed out", ready({ template: "nope" })));
  assert.deepEqual(stale, {
    report: { status: "ready", value: {} },
    label: "boat: list failed",
    problem: "Could not list boat templates: boat timed out",
    launch: null,
  });

  const unset = chipView({}, failed("boat timed out", { status: "unavailable", message: "No boat API key is set." }));
  assert.deepEqual(unset.report, { status: "ready", value: {} });
  assert.equal(unset.label, "boat: list failed");
});

test("a pick changes one field of the current launch and reports the explicit triple", () => {
  const read = loaded();
  const { launch } = chipView({}, read);

  assert.deepEqual(pick(launch, choicesOf(read), { environment: "qa" }), {
    status: "ready",
    value: { template: "node-tools", environment: "qa", preset: "default" },
  });
  assert.deepEqual(pick(launch, choicesOf(read), { template: null }), {
    status: "ready",
    value: { template: null, environment: "base", preset: "default" },
  });
});

test("from a refused value, any pick is a way out: stock image in boat's default environment, at the default size", () => {
  const read = loaded({ template: "nope", environment: "gone", preset: "small" });
  const { launch } = chipView({}, read);
  assert.equal(launch, null);

  assert.deepEqual(pick(launch, choicesOf(read), { template: null }), {
    status: "ready",
    value: { template: null, environment: "base", preset: "small" },
  });
  assert.deepEqual(pick(launch, choicesOf(read), { preset: "large" }), {
    status: "ready",
    value: { template: null, environment: "base", preset: "large" },
  });
  assert.deepEqual(pick(launch, choicesOf(read), { template: "node-tools" }), {
    status: "ready",
    value: { template: "node-tools", environment: "base", preset: "small" },
  });
});
