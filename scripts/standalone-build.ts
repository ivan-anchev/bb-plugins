// node scripts/standalone-build.ts
// Build every plugin the way a marketplace install does: only the files git
// tracks for it, alone in a directory outside this workspace, then
// `npm install --omit=dev` and `bb plugin build`. The workspace build cannot
// catch a runtime import declared as a dev dependency, because the workspace
// has every dev dependency installed.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fail } from "./lib/cli.ts";
import { loadPlugins, ROOT, type Plugin } from "./lib/repo.ts";

const BB = join(ROOT, "node_modules", ".bin", "bb");

const failed = loadPlugins().filter((plugin) => !buildsStandalone(plugin));

if (failed.length > 0) fail(failed.map((plugin) => `${plugin.dir}: standalone install does not build`));

function buildsStandalone(plugin: Plugin): boolean {
  console.log(`\n▸ ${plugin.dir}: standalone npm install --omit=dev, bb plugin build`);
  const dir = mkdtempSync(join(tmpdir(), `bb-plugin-${plugin.id}-`));
  try {
    copyTrackedFiles(plugin.dir, dir);
    return succeeds("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], dir) && succeeds(BB, ["plugin", "build"], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function copyTrackedFiles(pluginDir: string, target: string): void {
  // Untrimmed: a path keeps every byte, leading spaces included.
  const listing = execFileSync("git", ["ls-files", "-z", "--", pluginDir], { cwd: ROOT, encoding: "utf8" });
  const tracked = listing.split("\0").filter(Boolean);
  for (const path of tracked) cpSync(join(ROOT, path), join(target, relative(pluginDir, path)));
}

function succeeds(command: string, args: string[], cwd: string): boolean {
  return spawnSync(command, args, { cwd, stdio: "inherit" }).status === 0;
}
