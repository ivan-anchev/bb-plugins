// A draft's done-criteria as its editor holds them, and the edits its keys make. Enter splits a
// criterion at the caret and Backspace at a criterion's start joins it to the one above, so one
// undoes the other; each edit says which field and caret take focus after it.
import { MAX_CRITERIA, MAX_CRITERION_CHARS } from "../../../model/crew.ts";

/** One criterion being edited; `key` keeps its field when one above it leaves. */
export type CriterionField = { key: number; text: string };

/** The criteria after an edit, and where focus goes: the field with `key`, its caret at `caret`. */
export type Edited = { fields: CriterionField[]; focus: { key: number; caret: number } };

export const fieldsOf = (criteria: readonly string[]): CriterionField[] => criteria.map((text, key) => ({ key, text }));

/** The criteria a save sends: trimmed, the empty ones dropped. */
export const criteriaOf = (fields: readonly CriterionField[]): string[] => fields.map((field) => field.text.trim()).filter((text) => text !== "");

/** Whether the list can take another criterion. */
export const hasRoom = (fields: readonly CriterionField[]): boolean => fields.length < MAX_CRITERIA;

export function typed(fields: readonly CriterionField[], key: number, text: string): CriterionField[] {
  return fields.map((field) => (field.key === key ? { key, text } : field));
}

/** A new, empty criterion at the end. */
export function added(fields: readonly CriterionField[]): Edited {
  const key = nextKey(fields);
  return { fields: [...fields, { key, text: "" }], focus: { key, caret: 0 } };
}

/**
 * Enter in criterion `index` with `start`–`end` selected: the selection goes, and the text after it
 * moves to a new criterion below, caret at its start. Null when the list is full.
 */
export function split(fields: readonly CriterionField[], index: number, start: number, end: number): Edited | null {
  const field = fields[index];
  if (field === undefined || !hasRoom(fields)) return null;
  const key = nextKey(fields);
  const next = [...fields];
  next.splice(index, 1, { key: field.key, text: field.text.slice(0, start) }, { key, text: field.text.slice(end) });
  return { fields: next, focus: { key, caret: 0 } };
}

/**
 * Backspace at the start of criterion `index`: its text joins the end of the one above, caret where
 * they meet. An empty criterion just goes. Null for the first, or when the two won't fit in one.
 */
export function joined(fields: readonly CriterionField[], index: number): Edited | null {
  const above = fields[index - 1];
  const field = fields[index];
  if (above === undefined || field === undefined) return null;
  const text = above.text + field.text;
  if (text.length > MAX_CRITERION_CHARS) return null;
  const next = fields.filter((_, i) => i !== index).map((other) => (other.key === above.key ? { key: above.key, text } : other));
  return { fields: next, focus: { key: above.key, caret: above.text.length } };
}

/** The list without criterion `index`; focus goes to the end of the one above it, or of the new first. */
export function removed(fields: readonly CriterionField[], index: number): Edited {
  const next = fields.filter((_, i) => i !== index);
  const target = next[Math.max(0, index - 1)];
  if (target === undefined) throw new Error("A draft keeps at least one done-criterion");
  return { fields: next, focus: { key: target.key, caret: target.text.length } };
}

const nextKey = (fields: readonly CriterionField[]): number => Math.max(-1, ...fields.map((field) => field.key)) + 1;
