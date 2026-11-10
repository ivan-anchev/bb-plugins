// The guide's first screen, under its title "What this PR does": the problem and the approach,
// before and after when behaviour changes, the findings, what the guide leaves out (and the tests
// and mocks the view options hide), and who wrote it.
import { useState, type ReactNode } from "react";
import type { GuideRecord } from "../../contract.ts";
import { fileOf, type DiffFile } from "../../diff/diff-schema.ts";
import type { Finding, Guide, HiddenItem } from "../../guide/guide-schema.ts";
import { stepNumberOfFinding, type VisibleFinding, type VisibleStep } from "../../guide/walkthrough.ts";
import type { PrHeadTarget } from "../queries.ts";
import { timeAgo } from "../relative-time.ts";
import { Button } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";
import { HunkDiff } from "./hunk-block.tsx";
import { PROSE_TYPE } from "./page-text.tsx";
import { Priority } from "./priority.tsx";
import { ShowToggle } from "./show-toggle.tsx";

type OverviewProps = {
  record: GuideRecord;
  files: DiffFile[];
  /** The PR at the guide's head, where the hidden hunks' diffs are. */
  head: PrHeadTarget;
  /** The findings the view options show; none while the findings switch is off. */
  findings: VisibleFinding[];
  /** The steps shown, which a finding's link counts in. */
  steps: VisibleStep[];
  onOpenStep(number: number): void;
  /** Test and mock hunks the view options hide; 0 while they are shown. */
  hiddenTests: number;
  onShowTests(): void;
};

export function Overview({ record, files, head, findings, steps, onOpenStep, hiddenTests, onShowTests }: OverviewProps) {
  const { overview, hidden } = record.guide;
  return (
    <>
      <Prose text={overview.problem} className={PROSE_TYPE} />
      <Prose text={overview.approach} className={PROSE_TYPE} />
      {overview.behaviour !== null && <BeforeAfter behaviour={overview.behaviour} />}
      {findings.length > 0 && (
        <Section title="Findings">
          <div className="grid gap-0.5">
            {findings.map(({ index, finding }) => (
              <FindingRow key={index} finding={finding} step={stepNumberOfFinding(steps, finding)} onOpenStep={onOpenStep} />
            ))}
          </div>
        </Section>
      )}
      {(hidden.length > 0 || hiddenTests > 0) && (
        <Section title="Not in this guide">
          <div className="grid gap-0.5">
            {hidden.map((item, i) => (
              <HiddenRow key={i} item={item} files={files} head={head} />
            ))}
            {hiddenTests > 0 && <HiddenTestsRow count={hiddenTests} onShow={onShowTests} />}
          </div>
        </Section>
      )}
      <Byline record={record} />
    </>
  );
}

type Behaviour = NonNullable<Guide["overview"]["behaviour"]>;

function BeforeAfter({ behaviour }: { behaviour: Behaviour }) {
  return (
    <div className="grid grid-cols-2 gap-7">
      <Section title="Before">
        <Sequence items={behaviour.before} />
      </Section>
      <Section title="After">
        <Sequence items={behaviour.after} />
      </Section>
    </div>
  );
}

// The last item is where the sequence lands, so it reads in full colour.
function Sequence({ items }: { items: string[] }) {
  return (
    <ol className="grid list-decimal gap-1.5 pl-[18px] text-[13.5px] leading-5 text-muted-foreground [&>li:last-child]:text-foreground">
      {items.map((item, i) => (
        <li key={i}>
          <Prose text={item} />
        </li>
      ))}
    </ol>
  );
}

type FindingRowProps = { finding: Finding; step: number | null; onOpenStep(number: number): void };

// The priority word and the title, and the step that shows the finding's hunk. A finding on a hunk
// the guide leaves out, or on a test the view options hide, has no step to go to. The link sits
// beside the title, never around it, so a link in the title works on its own.
function FindingRow({ finding, step, onOpenStep }: FindingRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-2">
      <span className="flex min-w-0 items-baseline gap-2 text-[13.5px]">
        <Priority priority={finding.priority} />
        <Prose text={finding.title} className="min-w-0" />
      </span>
      {step !== null && (
        // The negative margins keep the row's height and line the link up with the text column's edge.
        <div className="-my-1.5 -mr-2.5">
          <Button variant="ghost" size="small" aria-label={`Step ${step}: ${finding.title}`} onClick={() => onOpenStep(step)}>
            Step {step}
          </Button>
        </div>
      )}
    </div>
  );
}

// One left-out item: what it is and why, with Show expanding its diff or its list of files.
function HiddenRow({ item, files, head }: { item: HiddenItem; files: DiffFile[]; head: PrHeadTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <NotInGuideRow
        label={<HiddenLabel item={item} />}
        action={<ShowToggle open={open} subject={subjectOf(item)} onToggle={() => setOpen(!open)} />}
        reason={<Prose text={item.reason} className={REASON} />}
      />
      {open && <HiddenBody item={item} files={files} head={head} />}
    </div>
  );
}

// Tests and mocks are never in `hidden` (the validator puts them in a step): the view options hide
// them, and Show turns the switch on, which removes this row.
function HiddenTestsRow({ count, onShow }: { count: number; onShow(): void }) {
  return (
    <NotInGuideRow
      label={<span className="text-[13.5px]">Tests and mocks</span>}
      action={
        <Button variant="ghost" size="small" aria-label="Show tests and mocks" onClick={onShow}>
          Show
        </Button>
      }
      reason={
        <p className={REASON}>
          {count} {count === 1 ? "hunk" : "hunks"}, hidden by default. Showing them adds them to the steps that cover them.
        </p>
      }
    />
  );
}

const REASON = "col-start-1 text-[12.5px] leading-[18px] text-muted-foreground";

function NotInGuideRow({ label, action, reason }: { label: ReactNode; action: ReactNode; reason: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2">
      {label}
      {/* The negative margins keep the row's height and line "Show" up with the text column's edge. */}
      <div className="-my-1.5 -mr-2.5">{action}</div>
      {reason}
    </div>
  );
}

const isManyFiles = (item: HiddenItem) => item.kind === "files" && item.files.length > 1;

// A path, or "3 files" for an item of several files.
function subjectOf(item: HiddenItem): string {
  if (item.kind === "hunk") return item.file;
  return isManyFiles(item) ? `${item.files.length} files` : item.files[0];
}

function HiddenLabel({ item }: { item: HiddenItem }) {
  return <span className={isManyFiles(item) ? "text-[13.5px]" : "break-all font-mono text-[12.5px]"}>{subjectOf(item)}</span>;
}

function HiddenBody({ item, files, head }: { item: HiddenItem; files: DiffFile[]; head: PrHeadTarget }) {
  switch (item.kind) {
    case "hunk":
      return (
        <div className="pt-1 pb-2.5">
          <div className="overflow-hidden rounded-lg bg-muted/40">
            <HunkDiff file={fileOf(files, item.file)} hunk={item.hunk} head={head} />
          </div>
        </div>
      );
    case "files":
      return (
        <ul className="columns-2 pt-1 pb-2.5 font-mono text-xs leading-5 text-muted-foreground">
          {item.files.map((path) => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
        </ul>
      );
    default:
      return item satisfies never;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-2.5 grid content-start gap-2">
      <h3 className="text-[13px] font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Byline({ record }: { record: GuideRecord }) {
  const submittedAt = new Date(record.submittedAt).toISOString();
  return (
    <p className="mt-1.5 text-xs text-subtle-foreground">
      Written by {record.model ?? "the review thread"} for <code className="font-mono">{record.key.headSha.slice(0, 7)}</code>,{" "}
      <time dateTime={submittedAt} title={new Date(record.submittedAt).toLocaleString()}>
        {timeAgo(submittedAt, Date.now())}
      </time>
    </p>
  );
}
