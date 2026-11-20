import type { ComponentProps } from "react";

// bb's own Button, class for class (the plugin SDK does not export it); copied from pr-reviews,
// since plugins can't import each other.
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0";

const VARIANTS = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  outline: "border border-input bg-transparent hover:bg-state-hover hover:text-foreground",
  ghost: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
  // why: a choice among several, quieter than the one primary action; the theme's secondary button.
  secondary: "bg-secondary text-foreground hover:bg-state-active",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
} as const;

// why `sm-wrap`: a label the user must read whole, such as an option to choose, wraps on a narrow
// board instead of running past it.
const SIZES = {
  default: "h-9 whitespace-nowrap px-4 py-2 text-sm",
  sm: "h-8 whitespace-nowrap rounded-md px-3 text-xs",
  "sm-wrap": "min-h-8 max-w-full rounded-md px-3 py-1.5 text-left text-xs [overflow-wrap:anywhere]",
} as const;

type ButtonProps = Omit<ComponentProps<"button">, "type" | "className"> & { variant: keyof typeof VARIANTS; size?: keyof typeof SIZES; type?: "button" | "submit" };

export function Button({ variant, size = "default", type = "button", ...button }: ButtonProps) {
  return <button type={type} {...button} className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]}`} />;
}
