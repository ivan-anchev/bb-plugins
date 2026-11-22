import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorIdSchema } from "../../role.ts";
import { issueIdSchema } from "../issue.ts";
import { issueHref, issueLinkMarkdown, parseIssueHref, parseIssueSubPath } from "./issue-link.ts";

const COORDINATOR = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const ISSUE = issueIdSchema.parse("BBP-24");

test("an issue's link is its id linked to the plugin panel's route for it, and the route reads back as the same issue", () => {
  const href = `/plugins/regional-manager/regional-managers/issue/${COORDINATOR}/BBP-24`;
  assert.equal(issueHref(COORDINATOR, ISSUE), href);
  assert.equal(issueLinkMarkdown(COORDINATOR, ISSUE), `[BBP-24](${href})`);
  assert.deepEqual(parseIssueHref(href), { coordinatorId: COORDINATOR, issueId: ISSUE });
  assert.deepEqual(parseIssueSubPath(`issue/${COORDINATOR}/BBP-24`), { coordinatorId: COORDINATOR, issueId: ISSUE }, "the panel reads its own subPath of it");
});

test("an href that isn't an issue's route, or bends one, names no issue", () => {
  const hrefs = [
    "/plugins/regional-manager/regional-managers/issue/BBP-24",
    `/plugins/regional-manager/regional-managers/issue/not-a-uuid/BBP-24`,
    `/plugins/regional-manager/regional-managers/issue/${COORDINATOR}/bbp-24`,
    `/plugins/regional-manager/regional-managers/issue/${COORDINATOR}/BBP-24/more`,
    `/plugins/regional-manager/regional-managers/board/${COORDINATOR}`,
    `/plugins/another-plugin/regional-managers/issue/${COORDINATOR}/BBP-24`,
    `https://example.com/plugins/regional-manager/regional-managers/issue/${COORDINATOR}/BBP-24`,
    "BBP-24",
  ];
  for (const href of hrefs) assert.equal(parseIssueHref(href), null, href);
});
