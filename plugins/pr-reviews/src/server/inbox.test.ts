import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GitHubProject, InboxPr, PrState, Section, SectionKey } from "../contract.ts";
import { parseInboxSearch, parseStackContext, type FoundPr, type GitHubPr } from "../github/inbox-search.ts";
import { repoSchema, type Repo } from "../github/repo.ts";
import { buildSections, inboxPrs } from "./inbox.ts";

const BB = repoSchema.parse("ivan-anchev/bb-plugins");
const ATLAS = repoSchema.parse("octo-org/atlas");
const PROJECTS: GitHubProject[] = [
  { id: "proj_bb", name: "bb-plugins", repo: BB },
  { id: "proj_atlas", name: "atlas", repo: ATLAS },
];

type Fields = { state?: PrState; base?: string; updatedAt?: string; mergedAt?: string | null; repo?: Repo };

// PR `number` on branch `pr-<number>`, by default open on main and last updated on day `number` of November.
const gh = (number: number, { state = "OPEN", base = "main", updatedAt, mergedAt = null, repo = BB }: Fields = {}): GitHubPr => ({
  repo,
  number,
  title: `PR ${number}`,
  author: "ivan-anchev",
  state,
  updatedAt: updatedAt ?? `2026-11-${String(number % 28 + 1).padStart(2, "0")}T00:00:00Z`,
  mergedAt,
  baseRefName: base,
  headRefName: `pr-${number}`,
  ciFailing: false,
  changesRequested: false,
});

const found = (section: SectionKey, pr: GitHubPr): FoundPr => ({ section, pr });

const sectionsOf = (listed: FoundPr[], stackMates: GitHubPr[] = []) => buildSections(inboxPrs(listed, stackMates, PROJECTS));

// A section as text: a PR as `#n`, a lone stack member as `#n (i/size)`, a stack as `[#a #b …]`.
const outline = (section: Section) =>
  section.items.map((item) =>
    item.kind === "stack" ? `[${item.members.map((pr) => `#${pr.number}`).join(" ")}]` : `#${item.pr.number}${item.stack === null ? "" : ` (${item.stack.index}/${item.stack.size})`}`,
  );

test("three sections, always, in order, with their counts; an empty one is still there", () => {
  const sections = sectionsOf([found("authored", gh(1)), found("merged", gh(2, { state: "MERGED", mergedAt: "2026-11-11T00:00:00Z" }))]);
  assert.deepEqual(
    sections.map(({ key, count }) => [key, count]),
    [
      ["authored", 1],
      ["review", 0],
      ["merged", 1],
    ],
  );
  assert.deepEqual(sections[1].items, []);
});

test("most recent first: open and closed PRs by last activity, merged ones by when they merged", () => {
  const sections = sectionsOf([
    found("authored", gh(1, { updatedAt: "2026-11-01T00:00:00Z" })),
    found("authored", gh(2, { state: "CLOSED", updatedAt: "2026-11-09T00:00:00Z" })),
    found("authored", gh(3, { updatedAt: "2026-11-05T00:00:00Z" })),
    found("merged", gh(4, { state: "MERGED", updatedAt: "2026-11-12T00:00:00Z", mergedAt: "2026-11-06T00:00:00Z" })),
    found("merged", gh(5, { state: "MERGED", updatedAt: "2026-11-07T00:00:00Z", mergedAt: "2026-11-07T00:00:00Z" })),
  ]);
  assert.deepEqual(outline(sections[0]), ["#2", "#3", "#1"]);
  assert.deepEqual(outline(sections[2]), ["#5", "#4"]);
});

test("a stack takes its most recent PR's place and lists every PR bottom first, merged bottom and stack-mates elsewhere included", () => {
  const sections = sectionsOf(
    [
      found("authored", gh(87, { base: "pr-86", updatedAt: "2026-11-10T00:00:00Z" })),
      found("authored", gh(88, { base: "pr-87", updatedAt: "2026-11-11T00:00:00Z" })),
      found("authored", gh(83, { updatedAt: "2026-11-12T00:00:00Z" })),
      found("authored", gh(70, { updatedAt: "2026-11-01T00:00:00Z" })),
      found("merged", gh(86, { state: "MERGED", mergedAt: "2026-11-09T00:00:00Z" })),
      found("review", gh(90, { base: "pr-88", updatedAt: "2026-11-12T01:00:00Z" })),
    ],
    // A teammate's PR on top that asks nothing of the reader: in no section.
    [gh(91, { base: "pr-90" })],
  );
  assert.deepEqual(outline(sections[0]), ["#83", "[#86 #87 #88 #90 #91]", "#70"]);
  assert.equal(sections[0].count, 4);
  const stack = sections[0].items[1];
  assert.equal(stack.kind, "stack");
  assert.deepEqual(stack.kind === "stack" && stack.members.map((pr) => pr.section), ["merged", "authored", "authored", "review", null]);
  // In the other sections the stack has one PR each: a plain row that knows its place.
  assert.deepEqual(outline(sections[1]), ["#90 (4/5)"]);
  assert.deepEqual(outline(sections[2]), ["#86 (1/5)"]);
});

test("a PR opens in the first project with its repo, matched in any case; a PR of no project's repo is left out", () => {
  const projects: GitHubProject[] = [
    { id: "proj_atlas_lower", name: "atlas (fork checkout)", repo: repoSchema.parse("OCTO-ORG/ATLAS") },
    { id: "proj_atlas", name: "atlas", repo: ATLAS },
  ];
  const prs = inboxPrs([found("authored", gh(1, { repo: ATLAS })), found("authored", gh(2))], [], projects);
  assert.deepEqual(
    prs.map(({ repo, number, projectId }) => [repo, number, projectId]),
    [["octo-org/atlas", 1, "proj_atlas_lower"]],
  );
});

test("a PR found twice, or found and read again as a stack-mate, is listed once, in the section that found it", () => {
  const merged = gh(5, { state: "MERGED", mergedAt: "2026-11-07T00:00:00Z" });
  const prs = inboxPrs([found("merged", merged), found("merged", merged)], [merged, gh(6)], PROJECTS);
  assert.deepEqual(
    prs.map((pr: InboxPr) => [pr.number, pr.section, pr.projectId]),
    [
      [5, "merged", "proj_bb"],
      [6, null, "proj_bb"],
    ],
  );
});

test("the recorded responses: atlas's five-PR stack, beacon's bottom alone with its stack-mates elsewhere", () => {
  const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../github/fixtures/inbox/${name}.json`, import.meta.url), "utf8"));
  const projects: GitHubProject[] = [
    ...PROJECTS,
    { id: "proj_beacon", name: "beacon", repo: repoSchema.parse("Octo-Labs/beacon") },
    { id: "proj_ngx", name: "ngx-zero", repo: repoSchema.parse("ivan-anchev/ngx-zero") },
  ];
  const [authored, review, merged] = buildSections(inboxPrs(parseInboxSearch(fixture("search"), Date.parse("2026-11-12T10:00:00Z")), parseStackContext(fixture("context")), projects));

  assert.deepEqual(outline(authored), ["#83", "#81", "#79", "[#63 #64 #65 #66 #67]", "#42 (1/7)"]);
  assert.equal(authored.count, 9);
  assert.deepEqual(outline(review), ["#51", "#50", "#49"]);
  assert.deepEqual(outline(merged), ["#82", "#80", "#78"]);
});
