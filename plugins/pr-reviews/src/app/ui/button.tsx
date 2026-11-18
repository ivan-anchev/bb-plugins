import type { ComponentProps } from "react";

// bb's own Button, class for class (the plugin SDK does not export it).
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0";

// why aria-disabled too: some buttons stay focusable while inert, so a reason can be read with them.
const ARIA_DISABLED = "aria-disabled:cursor-default aria-disabled:opacity-50";

const VARIANTS = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border border-input bg-transparent hover:bg-state-hover hover:text-foreground",
  // An action that deletes, such as discarding a pending review, once the reader has confirmed it.
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  ghost:
    "hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground aria-pressed:hover:bg-state-active data-[state=open]:bg-state-active data-[state=open]:text-foreground data-[state=open]:hover:bg-state-active",
} as const;

// bb's base sets text-sm and its tailwind-merge drops it for sm; without the merge, it lives on
// default so the two sizes never fight over the font size.
const SIZES = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 rounded-md px-3 text-xs",
  // A header bar's text action, at its icon actions' height and icon size, so a ghost one sits
  // among them. why `!`: the base's size-4 for icons matches the same elements just as strongly.
  toolbar: "h-7 rounded-md px-2 text-xs [&_[data-icon-root]]:size-3.5!",
  icon: "h-9 w-9 text-sm",
} as const;

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

/** A button's look, for an element that acts like one but is not a <button>, such as a link. */
export function buttonClass(variant: Variant, size: Size = "default"): string {
  return `${BASE} ${ARIA_DISABLED} ${SIZES[size]} ${VARIANTS[variant]}`;
}

export type ButtonProps = Omit<ComponentProps<"button">, "type" | "className"> & { variant: Variant; size?: Size };

export function Button({ variant, size, ...button }: ButtonProps) {
  return <button type="button" {...button} className={buttonClass(variant, size)} />;
}
