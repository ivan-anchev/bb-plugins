import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parse as parseYaml } from "yaml";

/*
 * Every figure example in the agent skill renders through the real fence
 * renderer: the skill is the contract agents write against, so an example
 * that throws, or falls back to bb's code block, fails here.
 */

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const skillPath = join(pluginRoot, "skills/mdxcn/SKILL.md");

type Renderer = {
  languages: readonly string[];
  render: (language: string, code: string, status?: "closed" | "streaming") => string;
};

let renderer: Renderer;
let workDir: string;

before(async () => {
  // Inside the plugin so the bundle's external packages resolve from its node_modules.
  workDir = await mkdtemp(join(pluginRoot, "node_modules/.mdxcn-figures-"));
  const outfile = join(workDir, "render.mjs");
  await build({
    stdin: { contents: RENDER_ENTRY, loader: "tsx", resolveDir: pluginRoot },
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    alias: { "@": pluginRoot },
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  renderer = (await import(outfile)) as Renderer;
});

after(() => rm(workDir, { recursive: true, force: true }));

test("the skill's front matter is YAML that names and describes it", async () => {
  // bb skips a skill whose front matter doesn't parse, and configure() then fails on every thread.
  const markdown = await readFile(skillPath, "utf8");
  const frontMatter = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? "");
  assert.equal(frontMatter?.name, "mdxcn");
  assert.equal(typeof frontMatter?.description, "string");
});

test("the skill shows every figure bb registers", async () => {
  const shown = new Set((await skillExamples()).map((example) => example.language));
  const missing = renderer.languages.filter((language) => !shown.has(language));
  assert.deepEqual(missing, []);
});

test("every skill example renders as its figure", async () => {
  const failures: string[] = [];
  for (const { language, code } of await skillExamples()) {
    try {
      const html = renderer.render(language, code);
      if (!html.includes("<figure")) failures.push(`${language}: no figure (${html.slice(0, 120)})`);
      else if (html.includes(PENDING_MARK)) failures.push(`${language}: missing required props`);
    } catch (error) {
      failures.push(`${language}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("a figure missing its required data draws mdxcn's placeholder", () => {
  assert.ok(renderer.render("graph-kpi", "---\ntitle: Empty\n---\n").includes(PENDING_MARK));
});

test("a fence still streaming shows bb's code block", () => {
  assert.equal(renderer.render("callout", "Hello", "streaming"), ORIGINAL);
});

test("malformed front matter shows bb's code block and why", () => {
  const html = renderer.render("graph-kpi", "---\ntitle: [oops\n---\n");
  assert.ok(html.startsWith(ORIGINAL));
  assert.match(html, /valid YAML/);
});

type Example = { language: string; code: string };

/** Fences in the skill whose language is a figure bb registers. */
async function skillExamples(): Promise<Example[]> {
  const markdown = await readFile(skillPath, "utf8");
  const fences = /^(`{3,})([a-z0-9-]+)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
  return [...markdown.matchAll(fences)]
    .map((match) => ({ language: match[2] ?? "", code: match[3] ?? "" }))
    .filter(({ language }) => renderer.languages.includes(language));
}

/** What mdxcn's placeholder frame draws while a figure's required props are missing. */
const PENDING_MARK = "· · ·";

const ORIGINAL = `<pre data-original="true"></pre>`;

const RENDER_ENTRY = `
import { renderToStaticMarkup } from "react-dom/server";
import { FIGURE_LANGUAGES, FigureFence } from "./src/figure-fence";

const Original = () => <pre data-original />;
const message = { id: "msg", threadId: "thr", turnId: "turn", projectId: "proj" };

export const languages = FIGURE_LANGUAGES;

export function render(language, code, status = "closed") {
  return renderToStaticMarkup(
    <FigureFence code={code} language={language} status={status} index={0} message={message} Original={Original} />
  );
}
`;
