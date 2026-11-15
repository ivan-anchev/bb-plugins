import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { notesContract } from "./contract.ts";

const ids = (count: number) => Array.from({ length: count }, () => `note_${randomUUID()}`);

test("Delete takes every picked note in one call, past the brief's 100", () => {
  assert.ok(notesContract.deleteNotes.input.safeParse({ noteIds: ids(101) }).success);
  assert.ok(!notesContract.deleteNotes.input.safeParse({ noteIds: [] }).success);
});

test("a brief still takes at most 100 notes", () => {
  assert.ok(!notesContract.briefFor.input.safeParse({ noteIds: ids(101), projectId: "proj_personal" }).success);
  assert.ok(!notesContract.putInDraft.input.safeParse({ composerKey: "draft", brief: "Context from 101 notes:", noteIds: ids(101) }).success);
});
