import assert from "node:assert/strict";
import { test } from "node:test";
import { readFigureSource } from "./figure-source.ts";

test("a body without front matter is all Markdown", () => {
  assert.deepEqual(readFigureSource("- one\n- two\n"), {
    ok: true,
    props: {},
    body: "- one\n- two\n",
  });
});

test("front matter becomes typed props and the rest is the body", () => {
  const source = readFigureSource(
    "---\ntitle: Weekly\nvalue: 0.82\ndata: [1, 2]\nshow: true\n---\nSome **text**\n",
  );
  assert.deepEqual(source, {
    ok: true,
    props: { title: "Weekly", value: 0.82, data: [1, 2], show: true },
    body: "Some **text**\n",
  });
});

test("front matter alone, with no trailing newline, has an empty body", () => {
  assert.deepEqual(readFigureSource("---\ntitle: X\n---"), {
    ok: true,
    props: { title: "X" },
    body: "",
  });
});

test("empty front matter gives no props", () => {
  assert.deepEqual(readFigureSource("---\n---\nbody"), { ok: true, props: {}, body: "body" });
});

test("a later --- line stays in the body", () => {
  const source = readFigureSource("---\na: 1\n---\nabove\n---\nbelow");
  assert.deepEqual(source, { ok: true, props: { a: 1 }, body: "above\n---\nbelow" });
});

test("CRLF line endings read the same", () => {
  assert.deepEqual(readFigureSource("---\r\na: 1\r\n---\r\nbody"), {
    ok: true,
    props: { a: 1 },
    body: "body",
  });
});

test("unclosed front matter is an error", () => {
  const source = readFigureSource("---\ntitle: X\n");
  assert.equal(source.ok, false);
});

test("front matter that isn't a mapping is an error", () => {
  assert.equal(readFigureSource("---\n- a\n- b\n---\n").ok, false);
  assert.equal(readFigureSource("---\njust words\n---\n").ok, false);
});

test("invalid YAML is an error that says so", () => {
  const source = readFigureSource("---\ntitle: [unclosed\n---\n");
  assert.equal(source.ok, false);
  assert.match(source.ok ? "" : source.error, /valid YAML/);
});
