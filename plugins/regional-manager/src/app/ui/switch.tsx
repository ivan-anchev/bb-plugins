import { useId, type ReactNode } from "react";

type SwitchProps = {
  checked: boolean;
  onChange(checked: boolean): void;
  /** What it turns on, as the switch's name. */
  label: ReactNode;
  /** What on or off means, read after the name. */
  hint: ReactNode;
  /** While a change is saving: the switch keeps focus but takes no input. */
  pending?: boolean;
};

/**
 * An on/off switch as a menu row: its name, the switch at the row's end, and a line under them on
 * what the state means. The name toggles it too.
 */
export function Switch({ checked, onChange, label, hint, pending = false }: SwitchProps) {
  const ids = useId();
  return (
    <div className="flex flex-col">
      <div className="flex min-h-7 items-center gap-2 px-2">
        {/* why a label: a click on the name toggles the switch too, a bigger target. */}
        <label id={`${ids}-label`} htmlFor={`${ids}-switch`} className="min-w-0 flex-1 cursor-pointer text-[13px] leading-[18px] text-foreground select-none">
          {label}
        </label>
        <button
          id={`${ids}-switch`}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${ids}-label`}
          aria-describedby={`${ids}-hint`}
          // why aria-disabled: a disabled button drops focus to the page while the change saves.
          aria-disabled={pending}
          onClick={pending ? undefined : () => onChange(!checked)}
          className={`relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-disabled:cursor-default aria-disabled:opacity-70 motion-reduce:transition-none ${checked ? "bg-foreground" : "bg-muted-foreground/45"}`}
        >
          <span
            aria-hidden
            className={`size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none ${checked ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
      </div>
      <span id={`${ids}-hint`} className="px-2 pt-0.5 pb-1.5 text-xs text-muted-foreground text-pretty">
        {hint}
      </span>
    </div>
  );
}
