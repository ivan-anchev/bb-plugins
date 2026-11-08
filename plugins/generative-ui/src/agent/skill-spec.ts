// The skill's component reference is generated from OpenUI's library, so it
// can't drift from what the renderer draws. Everything outside the markers is
// written by hand.
import { componentSpec } from "../library.ts";
import { SKILL_NAME } from "./instructions.ts";

export const SKILL_PATH = new URL(`../../skills/${SKILL_NAME}/SKILL.md`, import.meta.url);

const BEGIN = "<!-- BEGIN GENERATED: `npm run skill` writes this section from OpenUI's library. Do not edit by hand. -->";
const END = "<!-- END GENERATED -->";

/** The skill text with its generated section replaced by the current spec. */
export function withCurrentSpec(skill: string): string {
  const start = skill.indexOf(BEGIN);
  const end = skill.indexOf(END);
  if (start === -1 || end < start) throw new Error(`${SKILL_PATH.pathname} has no generated-section markers`);
  return `${skill.slice(0, start)}${BEGIN}\n\n${componentSpec()}\n\n${skill.slice(end)}`;
}
