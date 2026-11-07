// Proves a submission covers the pinned PR diff exactly once, and turns the agent's wire format
// into the canonical Guide. Server only; pure.
import { hunkIdOf, numberedLines, unitIdsOf, WHOLE_FILE, type DiffFile, type HunkId } from "../diff/diff-schema.ts";
import { pathLiteral } from "../server/visible-text.ts";
import type { Finding, Guide, GuideHunk, GuideStep, HiddenItem, SubmitReviewInput } from "./guide-schema.ts";

export type Validation = { ok: true; guide: Guide } | { ok: false; message: string };

export function validateSubmission(input: SubmitReviewInput, files: DiffFile[]): Validation {
  const ledger = createCoverageLedger(files);
  const guide: Guide = {
    overview: { problem: input.overview.problem, approach: input.overview.approach, behaviour: input.overview.behaviour ?? null },
    steps: input.steps.map((step, index) => toStep(step, `step ${index + 1}`, ledger)),
    hidden: input.hidden.flatMap((item) => toHiddenItems(item, ledger)),
    findings: input.findings.flatMap((finding, index) => ledger.locateFinding(finding, `finding ${index + 1}`)),
  };
  const problems = ledger.problems();
  return problems.length === 0 ? { ok: true, guide } : { ok: false, message: formatProblems(problems) };
}

// ---------------------------------------------------------------------------------------
// Steps and hidden items: every reference goes through the ledger, which records where each
// unit was placed. An unknown reference is left out of the guide, but it is also a problem,
// and any problem rejects the whole submission, so a partial guide never reaches storage.

type InputStep = SubmitReviewInput["steps"][number];
type InputHidden = SubmitReviewInput["hidden"][number];
type InputFinding = SubmitReviewInput["findings"][number];

function toStep(step: InputStep, where: string, ledger: CoverageLedger): GuideStep {
  const hunks = step.hunks.flatMap((ref): GuideHunk[] =>
    ledger.place(ref.file, ref.hunk, where).map((hunk) => ({ file: ref.file, hunk, collapsed: ref.collapsed ?? null })),
  );
  return { title: step.title, explanation: step.explanation, forYou: step.forYou ?? null, hunks };
}

function toHiddenItems(item: InputHidden, ledger: CoverageLedger): HiddenItem[] {
  if ("files" in item) {
    item.files.forEach((file) => ledger.placeFile(file, "hidden"));
    return [{ kind: "files", files: item.files, reason: item.reason }];
  }
  return ledger.place(item.file, item.hunk, "hidden").map((hunk) => ({ kind: "hunk", file: item.file, hunk, reason: item.reason }));
}

// ---------------------------------------------------------------------------------------
// The ledger: the diff's units, where each was placed, and what went wrong.

type Side = Finding["side"];

type Problem =
  | { kind: "missing"; file: string; hunk: HunkId }
  | { kind: "duplicate"; file: string; hunk: HunkId; places: string[] }
  | { kind: "unknown-file"; file: string; where: string }
  | { kind: "unknown-hunk"; file: string; ref: string; valid: HunkId[]; where: string }
  | { kind: "finding-outside"; where: string; file: string; line: number; side: Side; ranges: string[] };

type CoverageLedger = ReturnType<typeof createCoverageLedger>;

function createCoverageLedger(files: DiffFile[]) {
  // Paths match exactly: the hunk list writes each one losslessly (visible-text.ts).
  const byPath = new Map(files.map((file) => [file.path, file]));
  const placements = new Map<string, string[]>(); // unit key -> ["step 2", "hidden", …]
  const found: Problem[] = [];

  const record = (file: string, hunk: HunkId, where: string) => {
    const key = unitKey(file, hunk);
    placements.set(key, [...(placements.get(key) ?? []), where]);
  };

  // The file at `path`, or null after recording that the PR has no such file.
  const fileAt = (path: string, where: string): DiffFile | null => {
    const file = byPath.get(path);
    if (file === undefined) found.push({ kind: "unknown-file", file: path, where });
    return file ?? null;
  };

  return {
    place(path: string, ref: string, where: string): HunkId[] {
      const file = fileAt(path, where);
      if (file === null) return [];
      const hunk = resolveHunkRef(file, ref);
      if (hunk === null) {
        found.push({ kind: "unknown-hunk", file: path, ref, valid: unitIdsOf(file), where });
        return [];
      }
      record(path, hunk, where);
      return [hunk];
    },

    placeFile(path: string, where: string): void {
      const file = fileAt(path, where);
      if (file !== null) unitIdsOf(file).forEach((hunk) => record(path, hunk, where));
    },

    // A finding must sit on a line some hunk shows on its side; it is stored with that hunk.
    locateFinding(input: InputFinding, where: string): Finding[] {
      const file = fileAt(input.file, where);
      if (file === null) return [];
      const side = input.side ?? "new";
      const hunk = file.hunks.find((candidate) => numberedLines(candidate).some((line) => line[side] === input.line));
      if (hunk === undefined) {
        found.push({ kind: "finding-outside", where, file: input.file, line: input.line, side, ranges: rangesOf(file, side) });
        return [];
      }
      return [{ ...input, side, hunk: hunkIdOf(hunk) }];
    },

    problems(): Problem[] {
      const coverage = files.flatMap((file) =>
        unitIdsOf(file).flatMap((hunk): Problem[] => {
          const places = placements.get(unitKey(file.path, hunk)) ?? [];
          if (places.length === 0) return [{ kind: "missing", file: file.path, hunk }];
          if (places.length > 1) return [{ kind: "duplicate", file: file.path, hunk, places }];
          return [];
        }),
      );
      return [...coverage, ...found];
    },
  };
}

const unitKey = (file: string, hunk: HunkId) => JSON.stringify([file, hunk]);

// Tolerant reading of the agent's `hunk`: the @@ marks, trailing function context and an
// omitted count are all optional. Starts must match; counts must match when given.
const RANGE = /^\s*(?:@@\s*)?-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?(?:\s*@@)?(?:\s.*)?$/;
const WHOLE_FILE_REF = /^\s*whole file\s*$/i;

function resolveHunkRef(file: DiffFile, ref: string): HunkId | null {
  if (file.hunks.length === 0) return WHOLE_FILE_REF.test(ref) ? WHOLE_FILE : null;
  const match = RANGE.exec(ref);
  if (match === null) return null;
  const [oldStart, oldLines, newStart, newLines] = match.slice(1).map((digits) => (digits === undefined ? null : Number(digits)));
  const hunk = file.hunks.find(
    (candidate) =>
      candidate.oldStart === oldStart &&
      candidate.newStart === newStart &&
      (oldLines === null || candidate.oldLines === oldLines) &&
      (newLines === null || candidate.newLines === newLines),
  );
  return hunk === undefined ? null : hunkIdOf(hunk);
}

// "first-last" of the line numbers each hunk shows on `side`; a hunk with none there is left out.
function rangesOf(file: DiffFile, side: Side): string[] {
  return file.hunks.flatMap((hunk) => {
    const numbers = numberedLines(hunk).flatMap((line) => (line[side] === null ? [] : [line[side]]));
    return numbers.length === 0 ? [] : [`${numbers[0]}-${numbers[numbers.length - 1]}`];
  });
}

// ---------------------------------------------------------------------------------------
// The message the agent reads. Paths are written as in the hunk list, so they can be copied.

const MAX_LISTED = 40;

const REJECTED =
  "submit_review was rejected and nothing was saved. Fix every problem below and call submit_review again with the whole guide. Do not drop a hunk to make a problem go away: put it in a step, or in hidden with a reason.";

function formatProblems(problems: Problem[]): string {
  const sections = [
    section("Missing: these hunks are in no step and not in hidden", problems, "missing", (p) => `${pathLiteral(p.file)} ${p.hunk}`),
    section("Listed more than once", problems, "duplicate", (p) => `${pathLiteral(p.file)} ${p.hunk} (${p.places.join(", ")})`),
    section("Unknown files", problems, "unknown-file", (p) => `${pathLiteral(p.file)} (in ${p.where}): not a file in this PR`),
    section("Unknown hunks", problems, "unknown-hunk", (p) =>
      `${pathLiteral(p.file)} ${JSON.stringify(p.ref)} (in ${p.where}): no such hunk. Its hunks are: ${p.valid.join(", ")}`,
    ),
    section("Findings outside the diff", problems, "finding-outside", (p) =>
      `${p.where} (${pathLiteral(p.file)} line ${p.line}, ${p.side} side): not inside any hunk. ${linesOnSide(p.side, p.ranges)}`,
    ),
  ];
  return [REJECTED, ...sections.filter((text) => text !== null)].join("\n\n");
}

const linesOnSide = (side: Side, ranges: string[]) =>
  ranges.length === 0 ? `Its hunks show no ${side}-side lines.` : `Its ${side}-side lines in hunks: ${ranges.join(", ")}`;

function section<K extends Problem["kind"]>(
  title: string,
  problems: Problem[],
  kind: K,
  line: (problem: Extract<Problem, { kind: K }>) => string,
): string | null {
  const items = problems.filter((problem): problem is Extract<Problem, { kind: K }> => problem.kind === kind);
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_LISTED).map((problem) => `  - ${line(problem)}`);
  const more = items.length > MAX_LISTED ? [`  …and ${items.length - MAX_LISTED} more`] : [];
  return [`${title} (${items.length}):`, ...shown, ...more].join("\n");
}
