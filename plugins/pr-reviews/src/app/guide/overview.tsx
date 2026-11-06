// The guide's first screen, under its title "What this PR does": the author's own description on
// demand, the problem and the approach, before and after when behaviour changes, what the guide
// leaves out, and who wrote it.
import { useState, type ReactNode } from "react";
import type { GuideRecord, PrDetail } from "../../contract.ts";
import { fileOf, type DiffFile } from "../../diff/diff-schema.ts";
import type { Guide, HiddenItem } from "../../guide/guide-schema.ts";
import { timeAgo } from "../relative-time.ts";
import { Button } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";
import { HunkDiff } from "./hunk-block.tsx";
import { PROSE } from "./page-text.tsx";
import { ShowToggle } from "./show-toggle.tsx";

type OverviewProps = { pr: PrDetail; record: GuideRecord; files: DiffFile[] };

export function Overview({ pr, record, files }: OverviewProps) {
  const { overview, hidden } = record.guide;
  return (
    <>
      {pr.body.trim() !== "" && <AuthorDescription author={pr.author} body={pr.body} />}
      <Prose text={overview.problem} className={PROSE} />
      <Prose text={overview.approach} className={PROSE} />
      {overview.behaviour !== null && <BeforeAfter behaviour={overview.behaviour} />}
      {hidden.length > 0 && <NotInGuide items={hidden} files={files} />}
      <Byline record={record} />
    </>
  );
}

function AuthorDescription({ author, body }: { author: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The negative margins line the label up with the text column. */}
      <div className="-mt-1.5 -ml-2.5 justify-self-start">
        <Button variant="ghost" size="small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide the author's description" : "Show the author's description"}
        </Button>
      </div>
      {open && (
        <section className="grid max-w-[75ch] gap-2.5 rounded-lg bg-muted px-4 py-3.5 text-[13.5px] leading-[21px]">
          <p className="text-xs text-subtle-foreground">{author} wrote</p>
          <Prose text={body} />
        </section>
      )}
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

function NotInGuide({ items, files }: { items: HiddenItem[]; files: DiffFile[] }) {
  return (
    <Section title="Not in this guide">
      <div className="grid gap-0.5">
        {items.map((item, i) => (
          <HiddenRow key={i} item={item} files={files} />
        ))}
      </div>
    </Section>
  );
}

// One left-out item: what it is and why, with Show expanding its diff or its list of files.
function HiddenRow({ item, files }: { item: HiddenItem; files: DiffFile[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2">
        <HiddenLabel item={item} />
        {/* The negative margins keep the row's height and line "Show" up with the text column's edge. */}
        <div className="-my-1.5 -mr-2.5">
          <ShowToggle open={open} subject={subjectOf(item)} onToggle={() => setOpen(!open)} />
        </div>
        <Prose text={item.reason} className="col-start-1 text-[12.5px] leading-[18px] text-muted-foreground" />
      </div>
      {open && <HiddenBody item={item} files={files} />}
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

function HiddenBody({ item, files }: { item: HiddenItem; files: DiffFile[] }) {
  switch (item.kind) {
    case "hunk":
      return (
        <div className="pt-1 pb-2.5">
          <div className="overflow-hidden rounded-lg bg-muted/40">
            <HunkDiff file={fileOf(files, item.file)} hunk={item.hunk} />
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
