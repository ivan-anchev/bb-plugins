// Copied verbatim from plugins/code-explorer/src/changes/change-kind.ts, plus isTestOrMock at the end.
export const CHANGE_KINDS = ["code", "tests", "mocks", "generated", "docs"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  code: "Code",
  tests: "Tests",
  mocks: "Mocks",
  generated: "Generated",
  docs: "Docs",
};

export const TEST_KINDS: readonly ChangeKind[] = ["tests", "mocks"];

const GENERATED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "deno.lock",
  "flake.lock",
  "gemfile.lock",
  "go.sum",
  "gradle.lockfile",
  "mix.lock",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "packages.lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "podfile.lock",
  "poetry.lock",
  "pubspec.lock",
  "uv.lock",
  "yarn.lock",
]);
const GENERATED_NAME =
  /(\.generated\.|\.gen\.|\.g\.dart$|\.pb\.go$|_pb2(_grpc)?\.py$|\.pb\.(cc|h)$|\.min\.(js|css)$|\.(js|css)\.map$)/;
const GENERATED_DIRS = new Set(["__generated__", "_generated", "generated"]);

const MOCK_NAME = /(\.snap$|\.(mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(mocks?|fixtures?|stubs?|fakes?)([-_.A-Z]|$))/;
const MOCK_DIRS = new Set([
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
  "fakes",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "stubs",
  "testdata",
]);

const TEST_NAME =
  /(\.(test|spec|e2e|eval)\.[^.]+$|_(test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(vitest|jest)\.setup\.[^.]+$)/i;
const CLASS_TEST_NAME = /(Tests?|Spec)\.(java|kt|kts|scala|groovy|cs|php|swift|m)$/;
const TEST_DIRS = new Set(["__tests__", "__test__", "cypress", "e2e", "evals", "spec", "specs", "test", "tests"]);

const DOCS_NAME = /\.(md|mdx|markdown|rst|adoc|txt)$/i;
const NOT_DOCS_NAME = /^(requirements.*|constraints.*|CMakeLists|robots|llms)\.txt$/i;

export function changeKindOf(path: string): ChangeKind {
  const segments = path.replaceAll("\\", "/").split("/");
  const name = segments.pop() ?? "";
  const dirs = segments.map((segment) => segment.toLowerCase());
  const inDir = (names: ReadonlySet<string>) => dirs.some((dir) => names.has(dir));
  if (GENERATED_FILES.has(name.toLowerCase()) || GENERATED_NAME.test(name) || inDir(GENERATED_DIRS)) return "generated";
  if (MOCK_NAME.test(name) || inDir(MOCK_DIRS)) return "mocks";
  if (TEST_NAME.test(name) || CLASS_TEST_NAME.test(name) || inDir(TEST_DIRS)) return "tests";
  if (DOCS_NAME.test(name) && !NOT_DOCS_NAME.test(name)) return "docs";
  return "code";
}

// PR Reviews' addition: tests and mocks are what the "Show tests and mocks" switch hides.
export const isTestOrMock = (path: string): boolean => TEST_KINDS.includes(changeKindOf(path));
