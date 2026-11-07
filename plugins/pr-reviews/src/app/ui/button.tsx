import type { ComponentProps } from "react";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88",
  secondary: "bg-secondary text-secondary-foreground hover:bg-state-active",
  ghost: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
} as const;

const SIZES = {
  default: "h-8 px-3 text-[13px]",
  small: "h-7 px-2.5 text-xs",
} as const;

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

/** A button's look, for an element that acts like one but is not a <button>, such as a link. */
export function buttonClass(variant: Variant, size: Size = "default"): string {
  return `inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,scale] duration-150 ease-out hover:duration-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 disabled:active:scale-100 aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${SIZES[size]} ${VARIANTS[variant]}`;
}

export type ButtonProps = Omit<ComponentProps<"button">, "type" | "className"> & { variant: Variant; size?: Size };

export function Button({ variant, size, ...button }: ButtonProps) {
  return <button type="button" {...button} className={buttonClass(variant, size)} />;
}
