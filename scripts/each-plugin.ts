// node scripts/each-plugin.ts <script>
// Run an npm script in every plugin that defines it. Unlike `npm run
// --workspaces`, this succeeds when plugins/ is still empty.
import { spawnSync } from "node:child_process";
import { fail } from "./lib/cli.ts";
import { loadPlugins, ROOT } from "./lib/repo.ts";

const script = process.argv[2] ?? fail(["usage: node scripts/each-plugin.ts <script>"]);
const failed = loadPlugins()
  .filter((plugin) => script in plugin.manifest.scripts)
  .filter((plugin) => !runIn(plugin.dir, script));

if (failed.length > 0) fail(failed.map((plugin) => `${plugin.dir}: \`npm run ${script}\` failed`));

function runIn(dir: string, script: string): boolean {
  console.log(`\n▸ ${dir}: npm run ${script}`);
  return spawnSync("npm", ["run", script, "--workspace", dir], { cwd: ROOT, stdio: "inherit" }).status === 0;
}
