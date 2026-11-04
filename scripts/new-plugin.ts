// npm run new -- <id>
// Scaffold plugins/<id> with `bb plugin new`, adopt it into this repository's
// conventions, and regenerate the manifests. Rerunning converges: an existing
// directory is never re-scaffolded, only re-adopted.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { exitWithProblems, fail, requirePluginIdArgument } from "./lib/cli.ts";
import { planManifests, writeManifestFiles } from "./lib/manifests.ts";
import { loadRepoConfig, PLUGINS_DIR, ROOT } from "./lib/repo.ts";

const id = requirePluginIdArgument("npm run new -- <id>");
const dir = `${PLUGINS_DIR}/${id}`;

if (!existsSync(join(ROOT, dir))) scaffoldWithBb(id, dir);
adoptIntoRepo(dir);
syncManifests();
runInherited("npm", ["install"], ROOT);
printNextSteps(dir);

// `bb plugin new` writes ./bb-plugin-<id> and runs npm install inside it. Stage
// it outside the repo, then move it in without its own node_modules and
// lockfile: the root workspace install owns those.
function scaffoldWithBb(id: string, dir: string): void {
  const staging = mkdtempSync(join(tmpdir(), "bb-plugin-new-"));
  runInherited("bb", ["plugin", "new", id], staging);
  const partial = join(ROOT, `${dir}.partial`);
  rmSync(partial, { recursive: true, force: true });
  cpSync(join(staging, `bb-plugin-${id}`), partial, { recursive: true, filter: isScaffoldSource });
  renameSync(partial, join(ROOT, dir));
  rmSync(staging, { recursive: true, force: true });
}

function isScaffoldSource(path: string): boolean {
  return !["node_modules", "package-lock.json"].includes(basename(path));
}

// Fields every plugin here carries. Setting them is idempotent.
function adoptIntoRepo(dir: string): void {
  const manifestPath = join(ROOT, dir, "package.json");
  const manifest = z
    .looseObject({ keywords: z.array(z.string()).default([]), scripts: z.record(z.string(), z.string()).default({}) })
    .parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const adopted = {
    ...manifest,
    private: true,
    license: "MIT",
    keywords: [...new Set(["bb-plugin", ...manifest.keywords])],
    repository: { type: "git", url: `git+${loadRepoConfig().gitUrl}`, directory: dir },
    scripts: { ...manifest.scripts, typecheck: "tsc -p .", build: "bb plugin build" },
  };
  writeFileSync(manifestPath, `${JSON.stringify(adopted, null, 2)}\n`);
}

function syncManifests(): void {
  const { files, problems } = planManifests();
  exitWithProblems(problems);
  writeManifestFiles(files);
}

function runInherited(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) fail([`\`${command} ${args.join(" ")}\` failed in ${cwd}`]);
}

function printNextSteps(dir: string): void {
  console.log(`
✓ ${dir} is ready and listed in .bb/plugins.json and marketplace.json.

Next:
  1. Edit bb.name, bb.description, and PLUGIN_OVERVIEW.md in ${dir}.
  2. Live loop:  bb plugin install ./${dir}  then  bb plugin dev ${dir}
  3. Run \`npm run manifests\` after any change to name, description, icon, keywords, or version.`);
}
