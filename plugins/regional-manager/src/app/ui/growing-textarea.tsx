import type { ComponentProps } from "react";

const FIELD = "col-start-1 row-start-1 rounded-md border px-2.5 py-1.5 text-base leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-sm sm:leading-5";

type GrowingTextareaProps = Omit<ComponentProps<"textarea">, "className" | "rows" | "value"> & { value: string };

export function GrowingTextarea({ value, ...textarea }: GrowingTextareaProps) {
  return (
    <div className="grid min-w-0 flex-1">
      <textarea
        {...textarea}
        value={value}
        rows={1}
        className={`${FIELD} resize-none overflow-hidden border-input bg-transparent text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
      />
      <span aria-hidden className={`${FIELD} invisible border-transparent`}>
        {`${value} `}
      </span>
    </div>
  );
}
