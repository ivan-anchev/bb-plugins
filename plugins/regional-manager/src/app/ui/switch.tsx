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

/** An on/off switch with its name and a hint beside it; the whole row toggles it. */
export function Switch({ checked, onChange, label, hint, pending = false }: SwitchProps) {
  const ids = useId();
  return (
    <div className="flex items-start gap-3">
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
        className={`relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-disabled:cursor-default aria-disabled:opacity-60 motion-reduce:transition-none ${checked ? "bg-foreground" : "bg-muted-foreground/45"}`}
      >
        <span
          aria-hidden
          className={`size-3.5 rounded-full bg-background shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* why a label: a click on the name toggles the switch too, a bigger target. */}
        <label id={`${ids}-label`} htmlFor={`${ids}-switch`} className="cursor-pointer text-sm font-medium select-none">
          {label}
        </label>
        <span id={`${ids}-hint`} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </span>
      </div>
    </div>
  );
}
