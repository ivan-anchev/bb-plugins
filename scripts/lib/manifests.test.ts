import assert from "node:assert/strict";
import { test } from "node:test";
import { COLLECTION_PATH, MARKETPLACE_PATH, renderManifests, type ManifestFile } from "./manifests.ts";
import type { Plugin, RepoConfig } from "./repo.ts";

const repo: RepoConfig = {
  gitUrl: "https://github.com/acme/bb-plugins.git",
  marketplace: {
    name: "acme",
    displayName: "Acme Plugins",
    description: "Plugins Acme maintains.",
    author: { name: "Acme", github: "acme" },
  },
};

function pluginFixture(id: string, overrides: { version?: string; icon?: string; keywords?: string[] } = {}): Plugin {
  return {
    id,
    dir: `plugins/${id}`,
    manifest: {
      name: `bb-plugin-${id}`,
      version: overrides.version ?? "0.3.1",
      keywords: overrides.keywords ?? ["bb-plugin"],
      scripts: {},
      dependencies: {},
      devDependencies: {},
      bb: { name: `Name of ${id}`, description: `What ${id} does.`, branding: { icon: overrides.icon ?? "Zap" } },
    },
  };
}

function parsed(files: ManifestFile[], path: string): any {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `${path} was rendered`);
  return file.content === null ? null : JSON.parse(file.content);
}

test("an empty repository has no collection file and an empty marketplace", () => {
  const files = renderManifests(repo, []);
  assert.equal(parsed(files, COLLECTION_PATH), null);
  assert.deepEqual(parsed(files, MARKETPLACE_PATH).plugins, []);
});

test("the collection indexes every plugin directory by id", () => {
  const files = renderManifests(repo, [pluginFixture("notes"), pluginFixture("status")]);
  assert.deepEqual(parsed(files, COLLECTION_PATH).plugins, [
    { name: "notes", source: "./plugins/notes" },
    { name: "status", source: "./plugins/status" },
  ]);
});

test("a marketplace entry installs its plugin's release tags across the major line", () => {
  const files = renderManifests(repo, [pluginFixture("notes", { version: "2.4.0" })]);
  const [entry] = parsed(files, MARKETPLACE_PATH).plugins;
  assert.deepEqual(entry.source, {
    git: { url: repo.gitUrl, subdir: "plugins/notes", range: "2.x", tagPrefix: "notes/" },
  });
  assert.equal(entry.displayName, "Name of notes");
  assert.deepEqual(entry.author, repo.marketplace.author);
});

test("a file icon becomes a URL relative to marketplace.json; a named icon passes through", () => {
  const files = renderManifests(repo, [
    pluginFixture("named", { icon: "ListTodo" }),
    pluginFixture("drawn", { icon: "./assets/icon.svg" }),
  ]);
  const icons = parsed(files, MARKETPLACE_PATH).plugins.map((entry: { icon: unknown }) => entry.icon);
  assert.deepEqual(icons, ["ListTodo", { url: "./plugins/drawn/assets/icon.svg" }]);
});

test("package keywords become store tags, minus the bb-plugin marker", () => {
  const files = renderManifests(repo, [pluginFixture("notes", { keywords: ["bb-plugin", "notes", "interface"] })]);
  assert.deepEqual(parsed(files, MARKETPLACE_PATH).plugins[0].tags, ["notes", "interface"]);
});
