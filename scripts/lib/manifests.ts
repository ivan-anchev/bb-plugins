// Generates the two bb manifests from the plugins' package.json files:
//   .bb/plugins.json  — the collection index behind `bb plugin install … --plugin <id>`
//   marketplace.json  — the catalog behind `bb marketplace add git:…`
// Both are derived, never hand-edited, so they cannot drift from the plugins.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { loadPlugins, loadRepoConfig, readJson, ROOT, type Plugin, type RepoConfig } from "./repo.ts";

export const COLLECTION_PATH = ".bb/plugins.json";
export const MARKETPLACE_PATH = "marketplace.json";

/** A generated file; `content: null` means the file must not exist. */
export type ManifestFile = { path: string; content: string | null };

export type ManifestPlan = { files: ManifestFile[]; problems: string[] };

/** Load the repo, render both manifests, and collect every problem with them. */
export function planManifests(): ManifestPlan {
  const plugins = loadPlugins();
  const files = renderManifests(loadRepoConfig(), plugins);
  return { files, problems: [...findRuleViolations(plugins), ...validateAgainstSchemas(files)] };
}

/** Paths whose committed content differs from the generated content. */
export function staleManifestPaths(files: ManifestFile[]): string[] {
  return files.filter((file) => readCurrent(file.path) !== file.content).map((file) => file.path);
}

/** Bring the committed files to the generated state; safe to rerun. */
export function writeManifestFiles(files: ManifestFile[]): void {
  for (const file of files) {
    const absolute = join(ROOT, file.path);
    if (file.content === null) rmSync(absolute, { force: true });
    else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, file.content);
    }
  }
}

export function renderManifests(repo: RepoConfig, plugins: Plugin[]): ManifestFile[] {
  return [
    { path: COLLECTION_PATH, content: renderCollection(repo, plugins) },
    { path: MARKETPLACE_PATH, content: toJsonFile(renderMarketplace(repo, plugins)) },
  ];
}

/** Repository conventions bb would otherwise only reject at install time. */
function findRuleViolations(plugins: Plugin[]): string[] {
  return plugins.flatMap((plugin) => [
    ...(plugin.dir === `plugins/${plugin.id}`
      ? []
      : [`${plugin.dir}: directory must be named after its plugin id "${plugin.id}"`]),
    ...unresolvableDependencies(plugin),
  ]);
}

// The collection schema requires at least one entry, so an empty repo has no file.
function renderCollection(repo: RepoConfig, plugins: Plugin[]): string | null {
  if (plugins.length === 0) return null;
  return toJsonFile({
    $schema: "https://getbb.app/schemas/plugins.schema.json",
    schemaVersion: 1,
    name: repo.marketplace.name,
    plugins: plugins.map((plugin) => ({ name: plugin.id, source: `./${plugin.dir}` })),
  });
}

function renderMarketplace(repo: RepoConfig, plugins: Plugin[]) {
  const { name, displayName, description, author } = repo.marketplace;
  return {
    $schema: "https://getbb.app/schemas/marketplace.schema.json",
    schemaVersion: 1,
    name,
    displayName,
    description,
    plugins: plugins.filter((plugin) => plugin.manifest.bbMarketplace.listed).map((plugin) => ({
      id: plugin.id,
      displayName: plugin.manifest.bb.name,
      description: plugin.manifest.bb.description,
      icon: marketplaceIcon(plugin),
      tags: plugin.manifest.keywords.filter((keyword) => keyword !== "bb-plugin"),
      author,
      source: {
        git: {
          url: repo.gitUrl,
          subdir: plugin.dir,
          range: releaseRange(plugin.manifest.version),
          tagPrefix: `${plugin.id}/`,
        },
      },
    })),
  };
}

// A named host icon passes through; a file path becomes a URL relative to
// marketplace.json, which bb resolves from the repository root.
function marketplaceIcon(plugin: Plugin): string | { url: string } {
  const icon = plugin.manifest.bb.branding.icon;
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(icon)) return icon;
  return { url: `./${plugin.dir}/${icon.replace(/^\.\//, "")}` };
}

// Track the whole major line, so every `<id>/vX.Y.Z` release tag reaches
// marketplace users without touching the catalog.
function releaseRange(version: string): string {
  return `${version.split(".")[0]}.x`;
}

// bb installs git plugins with plain `npm install --omit=dev` inside the plugin
// directory, with no workspace around it — these protocols cannot resolve there.
function unresolvableDependencies(plugin: Plugin): string[] {
  const { dependencies, devDependencies } = plugin.manifest;
  return Object.entries({ ...dependencies, ...devDependencies })
    .filter(([, range]) => /^(workspace|catalog|file|link):/.test(range))
    .map(([dependency, range]) => `${plugin.dir}: "${dependency}": "${range}" cannot resolve in a bb git install`);
}

function validateAgainstSchemas(files: ManifestFile[]): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return files.flatMap((file) => {
    if (file.content === null) return [];
    const validate = ajv.compile(readJson(schemaFor(file.path)) as object);
    if (validate(JSON.parse(file.content))) return [];
    return (validate.errors ?? []).map((issue) => `${file.path}: ${issue.instancePath || "/"} ${issue.message}`);
  });
}

function schemaFor(manifestPath: string): string {
  return manifestPath === COLLECTION_PATH ? "schema/plugins.schema.json" : "schema/marketplace.schema.json";
}

function readCurrent(path: string): string | null {
  const absolute = join(ROOT, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
