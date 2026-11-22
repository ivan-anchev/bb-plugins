import { Fragment, useState, type RefObject } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail, PrState, StateChange } from "../../contract.ts";
import type { Repo } from "../../github/repo.ts";
import { useChangePrState, type PrTarget } from "../queries.ts";
import { ReviewChatIconButton } from "../review-chat/review-chat-button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { PrStateBadge } from "../ui/pr-state-badge.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { HOLD_MS, useHold } from "../ui/use-hold.ts";
import { MergeButton } from "./merge-button.tsx";
import { PrIdentity } from "./pr-identity.tsx";
import { ReviewSubmit } from "./review-submit.tsx";

/** `title`: the heading, which takes focus when a control above it, such as a notice's, leaves. */
type PrHeaderProps = { target: PrTarget; repo: Repo; pr: PrDetail; hasReviewThread: boolean; title: RefObject<HTMLHeadingElement | null> };

export function PrHeader({ target, repo, pr, hasReviewThread, title }: PrHeaderProps) {
  return (
    <>
      <div className="pr-pane-header gap-2.5 px-6">
        <StateBadge target={target} state={pr.state} />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {repo} <span className="font-medium tabular-nums">#{pr.number}</span>
        </span>
        <div className="-mr-1.5 ml-auto flex shrink-0 items-center gap-1">
          <ReviewSubmit target={target} focusAfter={title} />
          <MergeButton target={target} pr={pr} focusAfter={title} />
          {hasReviewThread && <ReviewChatIconButton />}
          <IconLink icon="Github" label="Open on GitHub" href={pr.url} />
        </div>
      </div>
      <header className="flex shrink-0 flex-col gap-0.5 px-6 pt-4 pb-1.5">
        <h1 ref={title} tabIndex={-1} className="outline-none text-[17px] leading-6 font-semibold text-pretty break-words">
          {pr.title}
        </h1>
        <PrIdentity pr={pr} />
      </header>
    </>
  );
}

export const STATE_TILES = {
  OPEN: { label: "Open", icon: "GitPullRequest", color: "text-success" },
  DRAFT: { label: "Draft", icon: "GitPullRequestDraft", color: "text-muted-foreground" },
  MERGED: { label: "Merged", icon: "GitMerge", color: "text-pr-merged" },
  CLOSED: { label: "Closed", icon: "GitPullRequestClosed", color: "text-destructive-text" },
} as const satisfies Record<PrState, { label: string; icon: string; color: string }>;

const CHANGES_FROM = {
  OPEN: ["draft", "close"],
  DRAFT: ["ready", "close"],
  CLOSED: ["reopen"],
} as const satisfies Record<Exclude<PrState, "MERGED">, readonly StateChange[]>;

const CHANGES = {
  ready: { label: "Ready for review", doing: "Marking ready for review…", to: "OPEN" },
  draft: { label: "Convert to draft", doing: "Converting to draft…", to: "DRAFT" },
  close: { label: "Hold to close", doing: "Closing…", to: "CLOSED" },
  reopen: { label: "Reopen", doing: "Reopening…", to: "OPEN" },
} as const satisfies Record<StateChange, { label: string; doing: string; to: PrState }>;

function StateBadge({ target, state }: { target: PrTarget; state: PrState }) {
  if (state === "MERGED") {
    const { label } = STATE_TILES.MERGED;
    return (
      <span title="Merged pull requests can't change state">
        <PrStateBadge state={state} size="header">
          {label}
        </PrStateBadge>
        <span className="sr-only">State: {label}</span>
      </span>
    );
  }
  return <StateMenu target={target} state={state} />;
}

function StateMenu({ target, state }: { target: PrTarget; state: keyof typeof CHANGES_FROM }) {
  const changeState = useChangePrState();
  const [open, setOpen] = useState(false);
  const running = changeState.pendingInputs[0]?.change ?? null;
  const run = (change: StateChange) => {
    if (running !== null) return;
    changeState.mutate({ ...target, change }).then(() => setOpen(false), () => undefined);
  };
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && running === null) changeState.reset();
  };
  const { label } = STATE_TILES[state];
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`State: ${label}. Change state`}
          className="group/state cursor-pointer rounded-md transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <PrStateBadge
            state={state}
            size="header"
            className="pr-1 transition-colors duration-150 ease-out group-hover/state:bg-current/15 group-hover/state:duration-0 group-data-[state=open]/state:bg-current/20 motion-reduce:transition-none"
          >
            {label}
            <Icon name="ChevronDown" className="size-3 opacity-70" />
          </PrStateBadge>
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        {CHANGES_FROM[state].map((change, index) =>
          change === "close" ? (
            <Fragment key={change}>
              {index > 0 && <MenuSeparator />}
              <CloseItem running={running === change} onRun={run} />
            </Fragment>
          ) : (
            <MenuItem key={change} keepOpen onSelect={() => run(change)}>
              <ChangeRow change={change} text={running === change ? CHANGES[change].doing : CHANGES[change].label} running={running === change} />
            </MenuItem>
          ),
        )}
        {changeState.error !== null && (
          <p role="alert" className="px-2 pt-1.5 pb-1 text-xs text-destructive-text">
            {changeState.error.message}
          </p>
        )}
      </MenuContent>
    </Menu>
  );
}

function CloseItem({ running, onRun }: { running: boolean; onRun(change: StateChange): void }) {
  const hold = useHold(() => onRun("close"));
  const text = running ? CHANGES.close.doing : hold.nudged ? "Keep holding to close" : CHANGES.close.label;
  return (
    <MenuItem keepOpen onSelect={() => undefined} {...hold.handlers}>
      <span
        aria-hidden
        style={hold.holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
        className={`absolute inset-0 origin-left rounded-sm bg-destructive/15 transition-transform ${hold.holding ? "scale-x-100 ease-linear" : "scale-x-0 duration-150 ease-out"}`}
      />
      <ChangeRow change="close" text={text} running={running} />
    </MenuItem>
  );
}

function ChangeRow({ change, text, running }: { change: StateChange; text: string; running: boolean }) {
  const to = CHANGES[change].to;
  return (
    <>
      <span className="relative inline-flex items-center gap-1.5">
        {running && <Spinner size="small" />}
        {text}
      </span>
      <PrStateBadge state={to} className="relative">
        {STATE_TILES[to].label}
      </PrStateBadge>
    </>
  );
}
