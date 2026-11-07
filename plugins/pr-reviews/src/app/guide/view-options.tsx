// The reader's view options: remembered for the session, and set from the PR header's icon button,
// whose popover holds a switch per option.
import { useState } from "react";
import { testHunkCount, type ViewOptions } from "../../guide/walkthrough.ts";
import { useGuide, type GuideTarget } from "../queries.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

/** The options and their setter, owned by the PR page so its header and its guide share them. */
export type ViewOptionsState = { options: ViewOptions; setOptions(options: ViewOptions): void };

// Remembered for the session, across PRs, and never persisted: a reload starts with tests hidden.
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

/** The header's action for a PR with a guide. It shows once the guide has loaded. */
export function GuideViewOptions({ target, viewOptions }: GuideViewOptionsProps) {
  const guide = useGuide(target);
  // Its only option so far is the tests switch, so a guide without tests has no button.
  if (guide.data === undefined || testHunkCount(guide.data.record.guide) === 0) return null;
  return <ViewOptionsButton {...viewOptions} />;
}

function ViewOptionsButton({ options, setOptions }: ViewOptionsState) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon="SlidersHorizontal" label="View options" />
      </PopoverTrigger>
      <PopoverContent label="View options">
        <Switch label="Show tests and mocks" checked={options.showTests} onChange={(showTests) => setOptions({ ...options, showTests })} />
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
