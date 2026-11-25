// A regional manager's avatar: its still blob in its hue, drawn as the Regional Manager plugin draws
// it; or, while its look is unknown, a plain disc the same size.
import { BlobAvatar } from "blob-avatar";
import type { Avatar } from "../../model/manager-look.ts";
import { HUE_COLORS } from "../../model/project-hue.ts";

const SIZE = 28;

// why: blob-avatar draws in a 200-unit box whose body spans about 136 of it, so a box this much
// larger, its overflow given back by negative margins, makes the body fill the size asked for.
const BOX = Math.round(SIZE * (200 / 136));

// why paused: a still picture, as the Regional Manager plugin shows it. why aria-hidden: the name beside it says who this is.
export function ManagerAvatar({ avatar }: { avatar: Avatar | null }) {
  if (avatar === null) return <span className="as-avatar-plain" aria-hidden />;
  return (
    <BlobAvatar
      aria-hidden
      shape={avatar.shape}
      color={HUE_COLORS[avatar.hue].fill}
      expression={avatar.expression}
      animation="idle"
      paused
      size={BOX}
      className="as-avatar"
      style={{ margin: (SIZE - BOX) / 2 }}
    />
  );
}
