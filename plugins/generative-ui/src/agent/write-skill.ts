// npm run skill
// Rewrite the skill's generated component reference from OpenUI's library.
import { readFileSync, writeFileSync } from "node:fs";
import { SKILL_PATH, withCurrentSpec } from "./skill-spec.ts";

writeFileSync(SKILL_PATH, withCurrentSpec(readFileSync(SKILL_PATH, "utf8")));
console.log(`Wrote ${SKILL_PATH.pathname}`);
