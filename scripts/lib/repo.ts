// The repository model every script works from: the root config and one
// parsed record per plugin directory. Each plugin's package.json is the single
// source of truth; the bb manifests are generated from it (see manifests.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

export const ROOT = resolve(import.meta.dirname, "../..");
export const PLUGINS_DIR = "plugins";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const repoConfigSchema = z.object({
  repository: z.object({ url: z.string().startsWith("git+https://") }),
  bbMarketplace: z.object({
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    author: z.object({ name: z.string(), github: z.string() }),
  }),
});

const pluginPackageSchema = z.object({
  name: z.string(),
  version: z.string().regex(SEMVER, "must be a plain semver version"),
  keywords: z.array(z.string()).default([]),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  bb: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    branding: z.object({
      icon: z.string().min(1, "this repo requires bb.branding.icon (the marketplace lists it)"),
    }),
  }),
});

export type PluginPackage = z.infer<typeof pluginPackageSchema>;

export type RepoConfig = {
  /** Clone URL bb installs from, e.g. https://github.com/acme/bb-plugins.git */
  gitUrl: string;
  marketplace: z.infer<typeof repoConfigSchema>["bbMarketplace"];
};

export type Plugin = {
  /** The id bb derives from the package name; also the directory name. */
  id: string;
  /** Repository-relative directory, e.g. plugins/notes */
  dir: string;
  manifest: PluginPackage;
};

export function loadRepoConfig(): RepoConfig {
  const root = repoConfigSchema.parse(readJson("package.json"));
  return {
    gitUrl: root.repository.url.replace(/^git\+/, ""),
    marketplace: root.bbMarketplace,
  };
}

/** Every plugin directory, sorted by id. Throws on a malformed package.json. */
export function loadPlugins(): Plugin[] {
  return listPluginDirs()
    .map(loadPlugin)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** bb's rule: final package-name component minus `bb-plugin-`, slugified. */
function pluginIdFromPackageName(packageName: string): string {
  const finalComponent = packageName.split("/").at(-1) ?? packageName;
  return finalComponent
    .replace(/^bb-plugin-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function readJson(repoRelativePath: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, repoRelativePath), "utf8"));
}

function listPluginDirs(): string[] {
  const pluginsRoot = join(ROOT, PLUGINS_DIR);
  if (!existsSync(pluginsRoot)) return [];
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${PLUGINS_DIR}/${entry.name}`)
    .filter((dir) => existsSync(join(ROOT, dir, "package.json")));
}

function loadPlugin(dir: string): Plugin {
  const parsed = pluginPackageSchema.safeParse(readJson(`${dir}/package.json`));
  if (!parsed.success) {
    throw new Error(`${dir}/package.json: ${z.prettifyError(parsed.error)}`);
  }
  return { id: pluginIdFromPackageName(parsed.data.name), dir, manifest: parsed.data };
}
