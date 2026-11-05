import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

export function TabFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">{children}</div>;
}

export function Toolbar({ children, onRefresh }: { children: ReactNode; onRefresh(): void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
      {children}
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        onClick={onRefresh}
        className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name="RotateCcw" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export type SegmentOption<Value extends string> = { value: Value; label: string; title?: string };

type SegmentedControlProps<Value extends string> = {
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange(value: NoInfer<Value>): void;
};

export function SegmentedControl<Value extends string>({ label, options, value, onChange }: SegmentedControlProps<Value>) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          {option.label}
        </button>
      ))}
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
