import { useState } from "react";
import type { Guide } from "../../guide/guide-schema.ts";
import { testHunkCount, type ViewOptions } from "../../guide/walkthrough.ts";
import { useGuide, type PrHeadTarget } from "../queries.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

/** The options and their setter, owned by the PR page so its tab bar and its guide share them. */
export type ViewOptionsState = { options: ViewOptions; setOptions(options: ViewOptions): void };

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

type GuideViewOptionsProps = { head: PrHeadTarget; viewOptions: ViewOptionsState };

/** The tab bar's action on the Guide tab of a PR with a guide. It shows once the guide has loaded. */
export function GuideViewOptions({ head, viewOptions }: GuideViewOptionsProps) {
  const guide = useGuide(head);
  if (guide.data === undefined) return null;
  return <ViewOptionsButton guide={guide.data.record.guide} {...viewOptions} />;
}

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

function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <label className="flex min-h-9 cursor-pointer touch-manipulation items-center justify-between gap-2.5 rounded-md px-2 text-sm hover:bg-state-hover has-focus-visible:ring-1 has-focus-visible:ring-ring">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="group relative h-4 w-7 shrink-0 cursor-pointer rounded-full bg-muted outline-none transition-colors duration-150 ease-out aria-checked:bg-primary motion-reduce:transition-none"
      >
        <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-muted-foreground transition-transform duration-150 ease-out group-aria-checked:translate-x-3 group-aria-checked:bg-primary-foreground motion-reduce:transition-none" />
      </button>
    </label>
  );
}
