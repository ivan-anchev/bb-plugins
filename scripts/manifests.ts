// Regenerate .bb/plugins.json and marketplace.json from plugins/*/package.json.
//   npm run manifests          write them
//   npm run manifests:check    fail if they are invalid or out of date (CI)
import { planManifests, staleManifestPaths, writeManifestFiles } from "./lib/manifests.ts";
import { exitWithProblems } from "./lib/cli.ts";

const checkOnly = process.argv.includes("--check");
const { files, problems } = planManifests();

exitWithProblems(problems);

if (checkOnly) {
  const stale = staleManifestPaths(files);
  exitWithProblems(stale.map((path) => `${path} is out of date — run \`npm run manifests\``));
  console.log("✓ manifests valid and up to date");
} else {
  writeManifestFiles(files);
  console.log(`✓ wrote ${files.map((file) => file.path).join(" and ")}`);
}
