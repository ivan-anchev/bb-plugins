import type { KeyboardEvent, ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { IconButton } from "./ui/icon-button.tsx";
import { segmentIndexAfterKey } from "./ui/segment-index.ts";

export function TabFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">{children}</div>;
}

export type RefreshHandle = { refresh(): void };

export function Toolbar({ children, onRefresh }: { children: ReactNode; onRefresh(): void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      {children}
      <div className="ml-auto">
        <IconButton icon="RotateCcw" label="Refresh" onClick={onRefresh} />
      </div>
    </div>
  );
}

export type SegmentOption<Value extends string> = { value: Value; label: string; icon: string };

type SegmentedControlProps<Value extends string> = {
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange(value: NoInfer<Value>): void;
};

const SEGMENT_CLASSES =
  "inline-flex h-[26px] cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SELECTED_SEGMENT_CLASSES = "bg-state-active text-foreground";
const IDLE_SEGMENT_CLASSES = "text-muted-foreground hover:bg-state-hover hover:text-foreground hover:duration-0";

export function SegmentedControl<Value extends string>({ label, options, value, onChange }: SegmentedControlProps<Value>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
    const next = segmentIndexAfterKey(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`${SEGMENT_CLASSES} ${selected ? SELECTED_SEGMENT_CLASSES : IDLE_SEGMENT_CLASSES}`}
          >
            <Icon name={option.icon} className="size-3.5 shrink-0" aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Notice({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "error" }) {
  return tone === "error" ? (
    <p role="alert" className="px-3 py-4 text-xs text-destructive">
      {children}
    </p>
  ) : (
    <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{children}</p>;
}

export function ViewerFrame({ path, children }: { path: string; children: ReactNode }) {
  return (
    <>
      <p title={path} className="shrink-0 truncate border-b border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {path}
      </p>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </>
  );
}

export function SelectFilePrompt() {
  return <Notice>Select a file</Notice>;
}
