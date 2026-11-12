// Icon-only actions: the label is both the accessible name and the tooltip. The tooltip opens
// below and toward the left, because icon actions sit at the right end of header bars. It repeats
// the name, so the trigger is not also described by it.
import type { ComponentProps } from "react";
import { experimental_Icon as Icon, UrlLink } from "@get-bb/plugin-sdk/app";
import { Tooltip } from "./tooltip.tsx";

const ICON_ACTION_CLASS =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-50 aria-pressed:bg-state-active aria-pressed:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground";

// "dismiss": smaller and quieter, for the × that closes a box from its top row, or a control that
// should not outweigh the list it sits over, such as the sidebar's Filter.
const SIZES = {
  default: "size-7 text-muted-foreground",
  dismiss: "size-6 text-subtle-foreground",
} as const;

type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label" | "title"> & {
  icon: string;
  label: string;
  indicator?: boolean;
  size?: keyof typeof SIZES;
};

export function IconButton({ icon, label, indicator = false, size = "default", ...button }: IconButtonProps) {
  return (
    <Tooltip content={label} placement="bottom-end">
      {() => (
        <button type="button" aria-label={label} {...button} className={`${ICON_ACTION_CLASS} ${SIZES[size]}`}>
          <Icon name={icon} className="size-3.5" aria-hidden />
          {indicator ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" /> : null}
        </button>
      )}
    </Tooltip>
  );
}

type IconLinkProps = { icon: string; label: string; href: string };

/** An icon-only link that bb opens outside the app, such as the PR on github.com. */
export function IconLink({ icon, label, href }: IconLinkProps) {
  return (
    <Tooltip content={label} placement="bottom-end">
      {() => (
        <UrlLink href={href} aria-label={label} className={`${ICON_ACTION_CLASS} ${SIZES.default}`}>
          <Icon name={icon} className="size-3.5" aria-hidden />
        </UrlLink>
      )}
    </Tooltip>
  );
}
