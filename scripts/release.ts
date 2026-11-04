// npm run release -- <id>
// Tag the current commit as `<id>/v<version>` from plugins/<id>/package.json.
// bb resolves marketplace ranges over these tags and refuses a tag that later
// moves, so this never retags: an existing tag on HEAD is a no-op, and an
// existing tag elsewhere means the version needs a bump. Pushing stays manual.
import { exitWithProblems, fail, requirePluginIdArgument, run } from "./lib/cli.ts";
import { planManifests, staleManifestPaths } from "./lib/manifests.ts";
import { loadPlugins } from "./lib/repo.ts";

const id = requirePluginIdArgument("npm run release -- <id>");
const plugin = loadPlugins().find((candidate) => candidate.id === id) ?? fail([`no plugin "${id}" under plugins/`]);
const tag = `${plugin.id}/v${plugin.manifest.version}`;

exitWithProblems(releaseBlockers());
const head = run("git", ["rev-parse", "HEAD"]);
const tagged = taggedCommit(tag);

if (tagged === head) {
  console.log(`✓ ${tag} already points at HEAD`);
} else if (tagged !== null) {
  fail([`${tag} already exists on ${tagged.slice(0, 12)}; bump ${plugin.dir}/package.json "version" first`]);
} else {
  run("git", ["tag", "--annotate", tag, "--message", `${plugin.manifest.bb.name} ${plugin.manifest.version}`]);
  console.log(`✓ tagged ${tag}`);
}
console.log(`\nPublish it with:  git push origin main ${tag}`);

function releaseBlockers(): string[] {
  const { files, problems } = planManifests();
  const stale = staleManifestPaths(files).map((path) => `${path} is out of date — run \`npm run manifests\` and commit`);
  const dirty = run("git", ["status", "--porcelain"]) === "" ? [] : ["working tree has uncommitted changes"];
  return [...problems, ...stale, ...dirty];
}

function taggedCommit(tag: string): string | null {
  const known = run("git", ["tag", "--list", tag]) !== "";
  return known ? run("git", ["rev-parse", `${tag}^{commit}`]) : null;
}
