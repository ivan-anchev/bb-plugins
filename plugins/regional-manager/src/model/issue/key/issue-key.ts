// A regional manager's issue key: the letters every one of its issue ids opens with, as BBP in
// BBP-4. Taken from the name of the bb project it works in as it starts, and stored with it, so
// renaming the project later never changes an id.
import { z } from "zod";

export const issueKeySchema = z.string().regex(/^[A-Z]{1,3}$/, "An issue key is one to three capital letters").brand<"issueKey">();
export type IssueKey = z.infer<typeof issueKeySchema>;

/** The key of a project with no letters in its name. */
const NO_LETTERS = "ISS";
const KEY_LENGTH = 3;

/**
 * The issue key of a project named `projectName`: with three or more words, the first letter of each
 * of the first three ("Acme Web App" → AWA); otherwise its first three letters ("bb-plugins" → BBP),
 * or as many as it has ("ui" → UI); ISS when it has none.
 */
export function issueKeyOf(projectName: string): IssueKey {
  const words = wordsOf(projectName);
  const letters = words.length >= KEY_LENGTH ? words.map((word) => word.charAt(0)).join("") : words.join("");
  return issueKeySchema.parse((letters.slice(0, KEY_LENGTH) || NO_LETTERS).toUpperCase());
}

/**
 * The name's words, split on spaces, `-`, `_`, `.` and camelCase boundaries, each keeping only its
 * ASCII letters, accents dropped ("Économie" → "Economie"); a word left with none is no word.
 */
function wordsOf(name: string): string[] {
  return name
    .normalize("NFD")
    .split(/[\s\-_.]+|(?<=[a-z])(?=[A-Z])/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter((word) => word !== "");
}
