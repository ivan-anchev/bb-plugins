// Merge: the header's split button that merges an open PR by a method its repo allows. The button
// merges with a merge commit, or by the first method the repo allows when it allows none; its
// chevron picks another. A merge can't be undone, so the button runs only after a press held
// HOLD_MS, by pointer or by Enter or Space, as a wash fills it; a shorter press asks to keep
// holding. A branch with conflicts can't merge, and the button says why instead. GitHub's refusal
// shows under the button until dismissed. Once GitHub has merged, the control says so until the
// re-read PR, now merged, drops it.
import { useState, type RefObject } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { MergeMethod, PrDetail } from "../../contract.ts";
import { useLifetime } from "../lifetime.ts";
import { useMergePr, type PrTarget } from "../queries.ts";
import { buttonClass } from "../ui/button.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu.tsx";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { HOLD_MS, useHold } from "../ui/use-hold.ts";

// GitHub's words for each method.
const METHODS = {
  merge: { label: "Merge", description: "Adds the branch's commits to the base with a merge commit." },
  squash: { label: "Squash and merge", description: "Combines the branch's commits into one commit on the base." },
  rebase: { label: "Rebase and merge", description: "Adds the branch's commits to the base one by one, with no merge commit." },
} as const satisfies Record<MergeMethod, { label: string; description: string }>;

const NUDGE = "Keep holding";
const DOING = "Merging…";

/** `focusAfter`: where focus goes once GitHub has merged, as the control is about to leave. */
type MergeButtonProps = { target: PrTarget; pr: PrDetail; focusAfter: RefObject<HTMLElement | null> };

export function MergeButton({ target, pr, focusAfter }: MergeButtonProps) {
  const [first, ...rest] = pr.mergeMethods;
  if (pr.state !== "OPEN" || first === undefined) return null;
  return <MergeControl target={target} methods={[first, ...rest]} conflicting={pr.conflicting} headSha={pr.headSha} focusAfter={focusAfter} />;
}

type MergeControlProps = {
  target: PrTarget;
  methods: [MergeMethod, ...MergeMethod[]];
  conflicting: boolean;
  /** The head the page shows: GitHub merges only while the PR's head is still this one. */
  headSha: string;
  focusAfter: RefObject<HTMLElement | null>;
};

function MergeControl({ target, methods, conflicting, headSha, focusAfter }: MergeControlProps) {
  const [method, setMethod] = useState(methods[0]);
  const [merged, setMerged] = useState(false);
  const merge = useMergePr();
  const life = useLifetime();
  const run = () => {
    if (merge.isPending) return;
    // The hook's error state reports a refusal; the rejection itself carries nothing more.
    merge.mutate({ ...target, method, headSha }).then(
      life.bind(() => {
        focusAfter.current?.focus();
        setMerged(true);
      }),
      () => undefined,
    );
  };
  const hold = useHold(run);

  if (merged) {
    return (
      <p role="status" className="flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
        <Icon name="Check" className="size-3.5 text-success-foreground" aria-hidden />
        Merged
      </p>
    );
  }
  const { label } = METHODS[method];
  const text = merge.isPending ? DOING : hold.nudged ? NUDGE : label;
  return (
    <Popover
      open={merge.error !== null}
      onOpenChange={(open) => {
        if (!open) merge.reset();
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex">
          <Tooltip placement="bottom-end" content={conflicting ? "This branch has conflicts to resolve before it can merge." : `Hold to ${label.toLowerCase()}`}>
            {(describedBy) => (
              <button
                type="button"
                aria-describedby={describedBy}
                aria-disabled={conflicting || merge.isPending}
                {...(conflicting ? {} : hold.handlers)}
                className={`${buttonClass("default", "sm")} relative overflow-hidden transition-[scale,background-color] ease-out active:scale-[0.97] aria-disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${methods.length > 1 ? "rounded-r-none" : ""}`}
              >
                <span
                  aria-hidden
                  style={hold.holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
                  className={`absolute inset-0 origin-left bg-background/25 transition-transform ${hold.holding ? "scale-x-100 ease-linear" : "scale-x-0 duration-150 ease-out"}`}
                />
                <ButtonText texts={[label, NUDGE, DOING]} shown={text} />
              </button>
            )}
          </Tooltip>
          {methods.length > 1 && <MethodMenu methods={methods} method={method} onChoose={setMethod} disabled={merge.isPending} />}
        </div>
      </PopoverAnchor>
      <PopoverContent label="Merge failed" width="w-72">
        <p role="alert" className="flex items-start gap-1.5 p-1 text-xs text-destructive-text">
          <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{merge.error?.message}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}

// Every text the button can show, stacked in one cell so it keeps the widest one's width as they
// change; only the shown one is visible, and read.
function ButtonText({ texts, shown }: { texts: string[]; shown: string }) {
  return (
    <span className="relative grid">
      {texts.map((text) => (
        <span key={text} aria-hidden={text !== shown} className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 ${text === shown ? "" : "invisible"}`}>
          {text === DOING && <Spinner size="small" tone="inherit" />}
          {text}
        </span>
      ))}
    </span>
  );
}

type MethodMenuProps = { methods: MergeMethod[]; method: MergeMethod; onChoose(method: MergeMethod): void; disabled: boolean };

// The chevron: picks the method the button merges by, from those the repo allows.
function MethodMenu({ methods, method, onChoose, disabled }: MethodMenuProps) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Merge method"
          disabled={disabled}
          className={`${buttonClass("default", "sm")} rounded-l-none border-l border-background/25 px-1.5 data-[state=open]:bg-foreground/90`}
        >
          <Icon name="ChevronDown" className="size-3.5" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-72">
        <MenuRadioGroup value={method} onValueChange={(value) => onChoose(methods.find((candidate) => candidate === value)!)}>
          {methods.map((option) => (
            <MenuRadioItem key={option} value={option}>
              <span className="grid gap-0.5">
                <span className="font-medium">{METHODS[option].label}</span>
                <span className="text-muted-foreground">{METHODS[option].description}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
