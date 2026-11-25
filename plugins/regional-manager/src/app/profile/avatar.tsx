// A regional manager's avatar, a still blob with nothing behind it: tiny in its thread, small in a
// list row, large in a page's header. why paused: still pictures only; dropping it animates them.
import { BlobAvatar } from "blob-avatar";
import { EDGED_HUE, HUES, type Avatar } from "../../model/profile/avatar.ts";

const SIZES = { xs: 20, sm: 28, lg: 40 } as const;

// why: blob-avatar draws in a 200-unit box whose body spans about 136 of it, so a box this much
// larger, its overflow given back by negative margins, makes the body fill the size asked for.
const BODY_SCALE = 200 / 136;

// why: a white body on a light surface shows no edge; a hairline in the colour of the theme's input
// borders (--input, which reads on white where --border fades), hugging its outline,
// gives it one. Each 0.5px shadow is one side; a blurred one would fade to nothing.
const EDGE = ["0.5px 0", "-0.5px 0", "0 0.5px", "0 -0.5px"].map((offset) => `drop-shadow(${offset} 0 var(--input))`).join(" ");

// why aria-hidden: the name beside it says who this is; the avatar only pictures it.
export function AvatarBlob({ avatar, size }: { avatar: Avatar; size: keyof typeof SIZES }) {
  const box = Math.round(SIZES[size] * BODY_SCALE);
  return (
    <BlobAvatar
      aria-hidden
      shape={avatar.shape}
      color={HUES[avatar.hue]}
      expression={avatar.expression}
      animation="idle"
      paused
      size={box}
      className="pointer-events-none shrink-0"
      style={{ margin: (SIZES[size] - box) / 2, filter: avatar.hue === EDGED_HUE ? EDGE : undefined }}
    />
  );
}
