import type { ComponentProps } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label"> & {
  icon: string;
  label: string;
  indicator?: boolean;
};

export function IconButton({ icon, label, indicator = false, ...button }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...button}
      className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-50 aria-pressed:bg-state-active aria-pressed:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
    >
      <Icon name={icon} className="size-3.5" aria-hidden />
      {indicator ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" /> : null}
    </button>
  );
}
