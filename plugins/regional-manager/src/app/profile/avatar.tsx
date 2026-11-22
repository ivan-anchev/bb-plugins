import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Avatar } from "../../model/profile.ts";

const SIZES = {
  xs: "size-5 rounded [&_[data-icon-root]]:size-3.5",
  sm: "size-7 rounded-md [&_[data-icon-root]]:size-4",
  lg: "size-10 rounded-lg [&_[data-icon-root]]:size-5",
} as const;

export function AvatarTile({ avatar, size }: { avatar: Avatar; size: keyof typeof SIZES }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-muted text-foreground ${SIZES[size]}`}>
      <Icon name={avatar.icon} />
    </span>
  );
}
