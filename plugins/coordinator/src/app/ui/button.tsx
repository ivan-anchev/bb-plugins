import type { ComponentProps } from "react";

// bb's own Button, class for class (the plugin SDK does not export it); copied from pr-reviews,
// since plugins can't import each other.
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0";

const VARIANTS = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  ghost: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
} as const;

const SIZES = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 rounded-md px-3 text-xs",
} as const;

type ButtonProps = Omit<ComponentProps<"button">, "type" | "className"> & { variant: keyof typeof VARIANTS; size?: keyof typeof SIZES };

export function Button({ variant, size = "default", ...button }: ButtonProps) {
  return <button type="button" {...button} className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]}`} />;
}
