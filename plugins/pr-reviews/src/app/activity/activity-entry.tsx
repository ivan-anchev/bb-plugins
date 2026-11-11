// One commit or event of the activity in words, as GitHub says it: who, in the foreground at weight
// 500, then what they did. A run's line lists these once opened; a run of one is its own line.
import type { ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { shortSha } from "../../contract.ts";
import type { Label } from "../../github/label.ts";
import type { RunEntry, RunItem } from "./activity-fold.ts";
import type { ActivityGlyphName } from "./activity-glyph.tsx";

export function glyphOf(entry: RunEntry): ActivityGlyphName {
  if (entry.kind === "label-pair") return "label";
  switch (entry.item.kind) {
    case "commit":
      return "commit";
    case "labeled":
      return "label";
    case "renamed":
      return "pencil";
    case "review-requested":
    case "review-dismissed":
    case "assigned":
      return "person";
    case "milestoned":
      return "milestone";
    case "force-pushed":
    case "base-changed":
      return "branch";
    case "referenced":
      return "mention";
    case "status":
      return entry.item.status === "branch-deleted" || entry.item.status === "branch-restored" ? "branch" : "state";
    default:
      return entry.item satisfies never;
  }
}

export function EntryWords({ entry }: { entry: RunEntry }) {
  if (entry.kind === "label-pair") {
    const { added, removed } = entry;
    return added.actor === removed.actor ? (
      <>
        <Who login={added.actor} /> added and removed <LabelName label={added.label} />
      </>
    ) : (
      <>
        <Who login={added.actor} /> added and <Who login={removed.actor} /> removed <LabelName label={added.label} />
      </>
    );
  }
  return <ItemWords item={entry.item} />;
}

function ItemWords({ item }: { item: RunItem }): ReactNode {
  switch (item.kind) {
    case "commit":
      return (
        <>
          <UrlLink href={item.url} className={`${SHA} ${LINK}`}>
            {shortSha(item.sha)}
          </UrlLink>{" "}
          <span className="text-foreground">{item.headline}</span>
        </>
      );
    case "labeled":
      return (
        <>
          <Who login={item.actor} /> {item.added ? "added" : "removed"} <LabelName label={item.label} />
        </>
      );
    case "renamed":
      return (
        <>
          <Who login={item.actor} /> changed the title <s>{item.from}</s> <span className="text-foreground">{item.to}</span>
        </>
      );
    case "review-requested":
      return (
        <>
          <Who login={item.actor} /> {item.requested ? "requested a review from" : "removed the review request for"} <Who login={item.reviewer} />
        </>
      );
    case "review-dismissed":
      return (
        <>
          <Who login={item.actor} /> dismissed <Who login={item.reviewer} />’s review
        </>
      );
    case "assigned":
      return (
        <>
          <Who login={item.actor} /> {item.assigned ? "assigned" : "unassigned"} <Who login={item.assignee} />
        </>
      );
    case "milestoned":
      return (
        <>
          <Who login={item.actor} /> {item.added ? "added this to" : "removed this from"} the <span className="text-foreground">{item.title}</span> milestone
        </>
      );
    case "force-pushed":
      return (
        <>
          <Who login={item.actor} /> force-pushed{item.before !== null && <> from <span className={SHA}>{shortSha(item.before)}</span></>}
          {item.after !== null && <> to <span className={SHA}>{shortSha(item.after)}</span></>}
        </>
      );
    case "base-changed":
      return (
        <>
          <Who login={item.actor} /> changed the base branch from <span className={SHA}>{item.from}</span> to <span className={SHA}>{item.to}</span>
        </>
      );
    case "referenced":
      return (
        <>
          <Who login={item.actor} /> mentioned this in{" "}
          <UrlLink href={item.url} className={`text-foreground ${LINK}`}>
            {item.ref} {item.title}
          </UrlLink>
        </>
      );
    case "status":
      return (
        <>
          <Who login={item.actor} /> {STATUS_WORDS[item.status]}
        </>
      );
    default:
      return item satisfies never;
  }
}

const STATUS_WORDS = {
  "ready-for-review": "marked this ready for review",
  draft: "marked this as a draft",
  closed: "closed this",
  reopened: "reopened this",
  "branch-deleted": "deleted the branch",
  "branch-restored": "restored the branch",
  "auto-merge-enabled": "enabled auto-merge",
  "auto-merge-disabled": "disabled auto-merge",
} as const satisfies Record<Extract<RunItem, { kind: "status" }>["status"], string>;

export const Who = ({ login }: { login: string }) => <b className="font-medium text-foreground">{login}</b>;

export const SHA = "font-mono text-[11.5px]";

const LINK = "rounded-sm decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

// The label's own colour as a dot, as the side panel's chips show it.
function LabelName({ label }: { label: Label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
    </span>
  );
}
