import assert from "node:assert/strict";
import { test } from "node:test";
import { issueKeyOf } from "./issue-key.ts";

test("a name of three or more words keys by the first letter of each of the first three", () => {
  assert.equal(issueKeyOf("Acme Web App"), "AWA");
  assert.equal(issueKeyOf("acme web app and more"), "AWA");
  assert.equal(issueKeyOf("acme_web.app"), "AWA");
  assert.equal(issueKeyOf("AcmeWebApp"), "AWA", "camelCase boundaries split words");
});

test("a name of fewer words keys by its first three letters, separators removed", () => {
  assert.equal(issueKeyOf("bb-plugins"), "BBP");
  assert.equal(issueKeyOf("regional"), "REG");
  assert.equal(issueKeyOf("regionalManager"), "REG");
  assert.equal(issueKeyOf("Économie"), "ECO", "accents dropped");
  assert.equal(issueKeyOf("b2b portal"), "BBP", "only letters count");
});

test("a name with fewer than three letters keys by what it has, and one with none by ISS", () => {
  assert.equal(issueKeyOf("ui"), "UI");
  assert.equal(issueKeyOf("x"), "X");
  assert.equal(issueKeyOf("2024"), "ISS");
  assert.equal(issueKeyOf("—"), "ISS");
  assert.equal(issueKeyOf(""), "ISS");
});
