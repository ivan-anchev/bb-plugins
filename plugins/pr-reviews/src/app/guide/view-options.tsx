// The reader's view options: remembered for the session, and set from the icon button at the end
// of the PR page's tab bar, whose popover holds a switch per option.
import { useState } from "react";
import type { Guide } from "../../guide/guide-schema.ts";
import { testHunkCount, type ViewOptions } from "../../guide/walkthrough.ts";
import { useGuide, type GuideTarget } from "../queries.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

/** The options and their setter, owned by the PR page so its tab bar and its guide share them. */
export type ViewOptionsState = { options: ViewOptions; setOptions(options: ViewOptions): void };

// Remembered for the session, across PRs, and never persisted: a reload starts with tests hidden
// and findings shown.
let rememberedOptions: ViewOptions = { showTests: false, showFindings: true };

export function useViewOptions(): ViewOptionsState {
  const [options, setOptions] = useState(rememberedOptions);
  return {
    options,
    setOptions: (next) => {
      rememberedOptions = next;
      setOptions(next);
    },
  };
}

type GuideViewOptionsProps = { target: GuideTarget; viewOptions: ViewOptionsState };

/** The tab bar's action on the Guide tab of a PR with a guide. It shows once the guide has loaded. */
export function GuideViewOptions({ target, viewOptions }: GuideViewOptionsProps) {
  const guide = useGuide(target);
  if (guide.data === undefined) return null;
  return <ViewOptionsButton guide={guide.data.record.guide} {...viewOptions} />;
}

// A switch shows only for what the guide has, and a guide with neither tests nor findings has no button.
function ViewOptionsButton({ guide, options, setOptions }: { guide: Guide } & ViewOptionsState) {
  const hasTests = testHunkCount(guide) > 0;
  const hasFindings = guide.findings.length > 0;
  if (!hasTests && !hasFindings) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon="SlidersHorizontal" label="View options" />
      </PopoverTrigger>
      <PopoverContent label="View options">
        {hasTests && <Switch label="Show tests and mocks" checked={options.showTests} onChange={(showTests) => setOptions({ ...options, showTests })} />}
        {hasFindings && <Switch label="Show findings" checked={options.showFindings} onChange={(showFindings) => setOptions({ ...options, showFindings })} />}
      </PopoverContent>
    </Popover>
  );
}

type SwitchProps = { label: string; checked: boolean; onChange(checked: boolean): void };

// The whole row is the switch, so its hit area is the row, and its name is the label.
function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex min-h-9 cursor-pointer touch-manipulation items-center justify-between gap-2.5 rounded-md px-2 text-left text-[13px] outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring"
    >
      {label}
      <span
        aria-hidden
        className="relative h-[15px] w-[26px] shrink-0 rounded-full bg-muted transition-colors duration-150 ease-out group-aria-checked:bg-primary motion-reduce:transition-none"
      >
        <span className="absolute top-[3px] left-[3px] size-[9px] rounded-full bg-muted-foreground transition-transform duration-150 ease-out group-aria-checked:translate-x-[11px] group-aria-checked:bg-primary-foreground motion-reduce:transition-none" />
      </span>
    </button>
  );
}
