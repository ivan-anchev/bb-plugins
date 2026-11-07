import type { ComponentProps } from "react";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88",
  secondary: "bg-secondary text-secondary-foreground hover:bg-state-active",
  ghost: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
} as const;

type ButtonProps = Omit<ComponentProps<"button">, "type" | "className"> & { variant: keyof typeof VARIANTS };

export function Button({ variant, ...button }: ButtonProps) {
  return (
    <button
      type="button"
      {...button}
      className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-[background-color,color,scale] duration-150 ease-out hover:duration-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${VARIANTS[variant]}`}
    />
  );
}
