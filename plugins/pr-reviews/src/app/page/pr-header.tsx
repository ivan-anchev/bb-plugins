// The PR header, a masthead: the PR's state pill, with `owner/repo #number` beside it, above the
// title and the identity row (author, `base ← head`) on the left; icon actions (Review chat when a
// review thread exists, then GitHub) on the right. The pill opens a menu of the state changes
// GitHub allows. The PR's line counts are on the Changes tab.
import { Fragment, useState, type Ref } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail, PrState, StateChange } from "../../contract.ts";
import type { Repo } from "../../github/repo.ts";
import { useChangePrState, type PrTarget } from "../queries.ts";
import { ReviewChatIconButton } from "../review-chat/review-chat-button.tsx";
import { IconLink } from "../ui/icon-button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { HOLD_MS, useHold } from "../ui/use-hold.ts";
import { PrIdentity } from "./pr-identity.tsx";

/** `title`: the heading, which takes focus when a control above it, such as a notice's, leaves. */
type PrHeaderProps = { target: PrTarget; repo: Repo; pr: PrDetail; hasReviewThread: boolean; title: Ref<HTMLHeadingElement> };

export function PrHeader({ target, repo, pr, hasReviewThread, title }: PrHeaderProps) {
  return (
    <header className="shrink-0 px-7 pt-4 pb-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <StatePill target={target} state={pr.state} />
        <span className="text-xs text-muted-foreground">
          {repo} <span className="font-medium tabular-nums">#{pr.number}</span>
        </span>
      </div>
      <div className={MASTHEAD}>
        <h1 ref={title} tabIndex={-1} className="outline-none text-[17px] leading-6 font-semibold text-pretty break-words [grid-area:title]">{pr.title}</h1>
        {/* -my-0.5 centers the 28px buttons on the title's 24px first line; -mr-1.5 lines the last
            glyph, not its hit area, up with the header's right edge. */}
        <div className="-my-0.5 -mr-1.5 flex gap-1 justify-self-end [grid-area:actions]">
          {hasReviewThread && <ReviewChatIconButton />}
          <IconLink icon="Github" label="Open on GitHub" href={pr.url} />
        </div>
        <div className="[grid-area:identity]">
          <PrIdentity pr={pr} />
        </div>
      </div>
    </header>
  );
}

// One layout at every width: the identity row runs under the actions, so a narrow page wraps the
// branches rather than leaving a column empty.
const MASTHEAD = "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 [grid-template-areas:'title_actions'_'identity_identity']";

// why a purple of our own: bb has no purple token. GitHub's merged purple mixed a quarter toward
// the foreground reads 5.04:1 on its tinted tile in the dark theme and 4.79:1 in light, over the
// 3:1 a graphic needs.
export const MERGED = "text-[color-mix(in_oklab,#8957e5_75%,var(--foreground))]";

export const STATE_TILES = {
  OPEN: { label: "Open", icon: "GitPullRequest", color: "text-success-foreground" },
  DRAFT: { label: "Draft", icon: "GitPullRequestDraft", color: "text-muted-foreground" },
  MERGED: { label: "Merged", icon: "GitMerge", color: MERGED },
  CLOSED: { label: "Closed", icon: "GitPullRequestClosed", color: "text-destructive-text" },
} as const satisfies Record<PrState, { label: string; icon: string; color: string }>;

// The changes GitHub allows from each state; a merged PR's state is final. Close comes last, apart.
const CHANGES_FROM = {
  OPEN: ["draft", "close"],
  DRAFT: ["ready", "close"],
  CLOSED: ["reopen"],
} as const satisfies Record<Exclude<PrState, "MERGED">, readonly StateChange[]>;

// Each change's row: its words, its words while gh runs, and the state it leads to, on its chip.
// GitHub decides what a closed draft reopens as.
const CHANGES = {
  ready: { label: "Ready for review", doing: "Marking ready for review…", to: "OPEN" },
  draft: { label: "Convert to draft", doing: "Converting to draft…", to: "DRAFT" },
  close: { label: "Hold to close", doing: "Closing…", to: "CLOSED" },
  reopen: { label: "Reopen", doing: "Reopening…", to: "OPEN" },
} as const satisfies Record<StateChange, { label: string; doing: string; to: PrState }>;

// The pill names the state in its color, on a wash of that color. It stays at every width, since
// it is the header's only mark of the state.
const PILL = "inline-flex h-7 items-center gap-1.5 rounded-lg pl-2 text-[13px] leading-4 font-semibold bg-[color-mix(in_oklab,currentColor_15%,transparent)]";

// why state words mixed toward the foreground: in the state's own color, on its wash, open's green
// reads 3.55:1 in bb's light theme and closed's red 3.94:1 on the menu in the grok theme. Mixed,
// each reads 4.5:1 or more in both. The icons keep the pure color.
const STATE_WORDS = "text-[color-mix(in_oklab,currentColor_70%,var(--foreground))]";

function StatePill({ target, state }: { target: PrTarget; state: PrState }) {
  if (state === "MERGED") {
    const { label, icon, color } = STATE_TILES.MERGED;
    return (
      <span title="Merged pull requests can't change state" className={`${PILL} pr-2.5 ${color}`}>
        <Icon name={icon} aria-hidden className="size-4" />
        <span className={STATE_WORDS}>{label}</span>
      </span>
    );
  }
  return <StateMenu target={target} state={state} />;
}

// While gh runs, the chosen row says so and the menu stays open; once GitHub has the change the menu
// closes, and the pill shows the new state when the re-read PR arrives. A refusal shows under the
// rows until the menu closes.
function StateMenu({ target, state }: { target: PrTarget; state: keyof typeof CHANGES_FROM }) {
  const changeState = useChangePrState();
  const [open, setOpen] = useState(false);
  const running = changeState.pendingInputs[0]?.change ?? null;
  const run = (change: StateChange) => {
    if (running !== null) return;
    // The hook's error state reports a refusal; the rejection itself carries nothing more.
    changeState.mutate({ ...target, change }).then(() => setOpen(false), () => undefined);
  };
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && running === null) changeState.reset();
  };
  const { label, icon, color } = STATE_TILES[state];
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`State: ${label}. Change state`}
          className={`${PILL} cursor-pointer pr-1.5 transition-[background-color,scale] duration-150 ease-out hover:bg-[color-mix(in_oklab,currentColor_23%,transparent)] hover:duration-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] data-[state=open]:bg-[color-mix(in_oklab,currentColor_23%,transparent)] motion-reduce:transition-none motion-reduce:active:scale-100 ${color}`}
        >
          <Icon name={icon} aria-hidden className="size-4" />
          <span className={STATE_WORDS}>{label}</span>
          <Icon name="ChevronDown" aria-hidden className="size-3.5 opacity-75" />
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

// Close runs only after a press held HOLD_MS, by pointer or by Enter or Space, as a wash fills the
// row; a shorter press asks to keep holding. Reopen undoes it, so it needs no dialog.
function CloseItem({ running, onRun }: { running: boolean; onRun(change: StateChange): void }) {
  const hold = useHold(() => onRun("close"));
  const text = running ? CHANGES.close.doing : hold.nudged ? "Keep holding to close" : CHANGES.close.label;
  return (
    // The hold chooses, not a click.
    <MenuItem keepOpen onSelect={() => undefined} {...hold.handlers}>
      <span
        aria-hidden
        style={hold.holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
        className={`absolute inset-0 origin-left rounded-sm bg-[color-mix(in_oklab,var(--destructive-text)_22%,transparent)] transition-transform ${hold.holding ? "scale-x-100 ease-linear" : "scale-x-0 duration-150 ease-out"}`}
      />
      <ChangeRow change="close" text={text} running={running} />
    </MenuItem>
  );
}

// The chip repeats the row's words as the state they lead to, so it is hidden from a screen reader.
function ChangeRow({ change, text, running }: { change: StateChange; text: string; running: boolean }) {
  const { label, icon, color } = STATE_TILES[CHANGES[change].to];
  return (
    <>
      <span className="relative inline-flex items-center gap-1.5">
        {running && <Spinner size="small" />}
        {text}
      </span>
      <span aria-hidden className={`relative inline-flex h-[18px] items-center gap-1 rounded-full pr-1.5 pl-[5px] text-[11px] font-medium bg-[color-mix(in_oklab,currentColor_14%,transparent)] ${color}`}>
        <Icon name={icon} className="size-[11px]" />
        <span className={STATE_WORDS}>{label}</span>
      </span>
    </>
  );
}
