// How the user picks a regional manager's avatar, below its profile's fields: Shuffle, which picks a
// look no other manager has while one is free, and the shape and the colour to pick one by hand,
// which may be another's.
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
      <Button ref={shuffle} variant="secondary" size="touch" aria-disabled={looks === null} onClick={() => looks !== null && onChange(shuffledLook(randomStart(), looks, value))}>
        <ShuffleGlyph />
        Shuffle
      </Button>
      {error !== null && (
        <div ref={focusToShuffle}>
          <ReadFailure onRetry={retry}>Could not read the other regional managers' looks, so Shuffle waits: {error.message}</ReadFailure>
        </div>
      )}
      <Choices legend="Shape" options={SHAPES} columns={7} chosen={value.shape} onChoose={(shape) => onChange({ ...value, shape })}>
        {(shape) => <AvatarBlob avatar={{ ...value, shape }} size="xs" />}
      </Choices>
      <Choices legend="Colour" options={HUE_NAMES} columns={6} chosen={value.hue} onChoose={(hue) => onChange({ ...value, hue })}>
        {(hue) => <span className="size-4 rounded-full" style={{ backgroundColor: HUES[hue] }} />}
      </Choices>
    </div>
  );
}

type ChoicesProps<Option extends string> = { legend: string; options: readonly Option[]; columns: number; chosen: Option; onChoose(option: Option): void; children(option: Option): ReactNode };

/**
 * One radio group under its legend, each option drawn by `children` and called by its name. why
 * native radios: one choice at a time, Tab reaches the chosen one and the arrow keys move between
 * them, as in any radio group.
 * why each option a 44px cell around its 32px tile: a finger's tap target, with the tiles and the
 * artwork in them kept at their size; the cells' 6px edge, taken back by the grid's margin and the
 * legend's, keeps the tiles where they stood. why `columns`, the most a row holds: the 21 shapes in
 * three rows of seven and the 12 colours in two of six share one grid on a wide editor; a narrower
 * one fits fewer whole cells to a row, never a cell cut off at its edge.
 */
function Choices<Option extends string>({ legend, options, columns, chosen, onChoose, children }: ChoicesProps<Option>) {
  const group = useId();
  return (
    // why self-stretch and min-w-0: the grid wraps to the editor's width only once the fieldset takes
    // that width, and a fieldset is never narrower than its content unless told so.
    <fieldset className="flex min-w-0 flex-col gap-1.5 self-stretch">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="-mx-1.5 grid" style={{ gridTemplateColumns: "repeat(auto-fill, 2.75rem)", maxWidth: `${columns * 2.75}rem` }}>
        {options.map((option) => (
          <label key={option} className="group flex size-11 cursor-pointer items-center justify-center">
            <input type="radio" name={group} aria-label={nameOf(option)} checked={chosen === option} onChange={() => onChoose(option)} className="peer sr-only" />
            <span className="flex size-8 items-center justify-center rounded-md transition-colors duration-150 group-hover:bg-state-hover group-hover:duration-0 peer-checked:bg-secondary peer-checked:ring-1 peer-checked:ring-border peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
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
