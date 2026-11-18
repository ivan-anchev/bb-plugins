// Merge: the header's split button that merges an open PR by a method its repo allows. It is a
// toolbar action, a ghost at the icon actions' height like Review beside it, its glyph in the
// merged colour. The button merges with a merge commit, or by the first method the repo allows
// when it allows none; its chevron picks another. A merge can't be undone, so the button runs only
// after a press held HOLD_MS, by pointer or by Enter or Space, as a wash fills it; a shorter press
// asks to keep holding, in its tooltip, so the label never changes the button's width. While gh
// runs, a spinner takes the glyph's place. A branch with conflicts can't merge: a warning takes
// the glyph's place and the tooltip says why. GitHub's refusal shows under the button until
// dismissed. Once GitHub has merged, the control says so until the re-read PR, now merged, drops it.
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
  const hint = conflicting ? "This branch has conflicts to resolve before it can merge." : `${hold.nudged ? "Keep holding" : "Hold"} to ${label.toLowerCase()}`;
  return (
    <Popover
      open={merge.error !== null}
      onOpenChange={(open) => {
        if (!open) merge.reset();
      }}
    >
      <PopoverAnchor asChild>
        {/* The divider between the halves gives way to either half's hover wash. */}
        <div className="group/merge flex items-center">
          <Tooltip placement="bottom-end" content={hint} forced={hold.nudged}>
            {(describedBy) => (
              <button
                type="button"
                aria-describedby={describedBy}
                aria-disabled={conflicting}
                aria-busy={merge.isPending}
                {...(conflicting || merge.isPending ? {} : hold.handlers)}
                className={`${buttonClass("ghost", "toolbar")} relative gap-1.5 overflow-hidden transition-[scale,background-color] ease-out active:scale-[0.97] aria-disabled:hover:bg-transparent aria-disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${methods.length > 1 ? "rounded-r-none pr-1.5" : ""}`}
              >
                <span
                  aria-hidden
                  style={hold.holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
                  className={`absolute inset-0 origin-left bg-pr-merged/20 transition-transform ${hold.holding ? "scale-x-100 ease-linear" : "scale-x-0 duration-150 ease-out"}`}
                />
                <MergeGlyph pending={merge.isPending} conflicting={conflicting} />
                <span className="relative">{label}</span>
              </button>
            )}
          </Tooltip>
          {methods.length > 1 && (
            <>
              <span aria-hidden className="h-3.5 w-px bg-border group-hover/merge:opacity-0" />
              <MethodMenu methods={methods} method={method} onChoose={setMethod} disabled={merge.isPending} />
            </>
          )}
          <span role="status" className="sr-only">
            {merge.isPending ? "Merging…" : ""}
          </span>
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

// The button's mark: the merge glyph, a spinner while gh runs, or a warning while conflicts block it.
function MergeGlyph({ pending, conflicting }: { pending: boolean; conflicting: boolean }) {
  if (pending) {
    return (
      <span className="relative text-pr-merged">
        <Spinner tone="inherit" />
      </span>
    );
  }
  if (conflicting) return <Icon name="AlertTriangle" className="relative text-warning-text" aria-hidden />;
  return <Icon name="GitMerge" className="relative text-pr-merged" aria-hidden />;
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
          className={`${buttonClass("ghost", "toolbar")} w-5.5 rounded-l-none px-0 text-muted-foreground`}
        >
          <Icon name="ChevronDown" />
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
