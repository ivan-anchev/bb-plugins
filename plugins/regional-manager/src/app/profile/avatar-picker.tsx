// How the user picks a regional manager's avatar, below its profile's fields: Shuffle, which picks a
// look no other manager has, and the shape and the colour to pick one by hand, which may be another's.
// Shuffle waits while the other managers' looks aren't known (useTakenLooks): a look it picked then
// could be theirs.
import { useId, useMemo, useRef, type ReactNode } from "react";
import { HUE_NAMES, HUES, randomStart, SHAPES, shuffledLook, type Avatar } from "../../model/profile/avatar.ts";
import { Button } from "../ui/button.tsx";
import { handFocusTo } from "../ui/focus-hand-off.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { AvatarBlob } from "./avatar.tsx";
import { useTakenLooks } from "./use-manager.ts";

export function AvatarPicker({ value, onChange }: { value: Avatar; onChange(next: Avatar): void }) {
  const { looks, error, retry } = useTakenLooks();
  const shuffle = useRef<HTMLButtonElement>(null);
  // why: a Retry that succeeds removes the notice it sits in; its focus goes to Shuffle, which that read
  // enabled. React detaches this parent's ref before the notice's own, which would send it to the page.
  const focusToShuffle = useMemo(() => handFocusTo(() => shuffle.current), []);
  // why aria-disabled: a disabled button drops focus to the page, and it is enabled again as soon as the looks are read.
  return (
    <div className="flex flex-col items-start gap-3">
      <Button ref={shuffle} variant="secondary" size="sm" aria-disabled={looks === null} onClick={() => looks !== null && onChange(shuffledLook(randomStart(), looks, value))}>
        <ShuffleGlyph />
        Shuffle
      </Button>
      {error !== null && (
        <div ref={focusToShuffle}>
          <ReadFailure onRetry={retry}>Could not read the other regional managers' looks, so Shuffle waits: {error.message}</ReadFailure>
        </div>
      )}
      <Choices legend="Shape" options={SHAPES} chosen={value.shape} onChoose={(shape) => onChange({ ...value, shape })}>
        {(shape) => <AvatarBlob avatar={{ ...value, shape }} size="xs" />}
      </Choices>
      <Choices legend="Colour" options={HUE_NAMES} chosen={value.hue} onChoose={(hue) => onChange({ ...value, hue })}>
        {(hue) => <span className="size-4 rounded-full" style={{ backgroundColor: HUES[hue] }} />}
      </Choices>
    </div>
  );
}

type ChoicesProps<Option extends string> = { legend: string; options: readonly Option[]; chosen: Option; onChoose(option: Option): void; children(option: Option): ReactNode };

/**
 * One radio group under its legend, each option drawn by `children` and called by its name. why
 * native radios: one choice at a time, Tab reaches the chosen one and the arrow keys move between
 * them, as in any radio group.
 */
function Choices<Option extends string>({ legend, options, chosen, onChoose, children }: ChoicesProps<Option>) {
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input type="radio" name={group} aria-label={nameOf(option)} checked={chosen === option} onChange={() => onChoose(option)} className="peer sr-only" />
            <span className="flex size-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-state-hover hover:duration-0 peer-checked:bg-secondary peer-checked:ring-1 peer-checked:ring-border peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
              {children(option)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** What a shape or a hue is called aloud: its name, capitalised. */
const nameOf = (option: string): string => option.charAt(0).toUpperCase() + option.slice(1);

/** Two crossing arrows, in the style of bb's own icons. */
function ShuffleGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
      <path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
      <path d="m18 14 4 4-4 4" />
    </svg>
  );
}
