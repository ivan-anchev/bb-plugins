import type { Section, SectionKey } from "../../contract.ts";
import { SECTION_TEXT } from "./section-text.ts";

const CHIP =
  "inline-flex h-6 shrink-0 cursor-pointer items-center rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-state-active aria-pressed:text-foreground";

type SectionChipsProps = {
  sections: readonly Section[];
  /** The one section listed, or null for all of them. */
  only: SectionKey | null;
  onOnlyChange(only: SectionKey | null): void;
};

export function SectionChips({ sections, only, onOnlyChange }: SectionChipsProps) {
  return (
    <div role="group" aria-label="Show one section" className="flex min-w-0 items-center gap-0.5">
      <button type="button" aria-pressed={only === null} onClick={() => onOnlyChange(null)} className={CHIP}>
        All
      </button>
      {sections.map(({ key }) => (
        <button key={key} type="button" aria-pressed={only === key} onClick={() => onOnlyChange(key)} className={CHIP}>
          {SECTION_TEXT[key].chip}
        </button>
      ))}
    </div>
  );
}
