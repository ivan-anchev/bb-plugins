// A regional manager's avatar: a SIZE-square frame holding its still blob in its hue, drawn as the
// Regional Manager plugin draws it, or, while its look is unknown, a plain disc filling the frame.
// The row's text aligns to the frame, whatever the shape paints inside it.
import { BlobAvatar } from "blob-avatar";
import type { CSSProperties } from "react";
import { MANAGER_HUE_COLORS, type Avatar } from "../../model/manager-look.ts";

// why: the size the name's line and the reply's line span exactly, with the gap between them (app.css .as-manager-words).
const SIZE = 36;

// why: blob-avatar 2.2.0 draws in a 200-unit box centred on 0, and none of its 21 shapes, in any of its
// 6 expressions, paints farther than 66.1 units from that centre (the cat's ears; the capsule reaches
// 64.4 across). Measured with getBBox, still; check again when blob-avatar changes. Scaling 2 × REACH
// units to the frame keeps every shape inside it, centred.
const REACH = 67;
const BOX = (SIZE * 200) / (2 * REACH);

const FRAME: CSSProperties = { width: SIZE, height: SIZE };
const PLACE: CSSProperties = { position: "absolute", left: (SIZE - BOX) / 2, top: (SIZE - BOX) / 2 };

// why: a white body on a light surface shows no edge; a hairline in the theme's border colour, hugging
// its outline, gives it one, as the Regional Manager plugin draws it. Each 0.5px shadow is one side; a
// blurred one would fade to nothing.
const EDGED: CSSProperties = { ...PLACE, filter: ["0.5px 0", "-0.5px 0", "0 0.5px", "0 -0.5px"].map((offset) => `drop-shadow(${offset} 0 var(--border))`).join(" ") };

// why paused: a still picture, as the Regional Manager plugin shows it. why aria-hidden: the name beside it says who this is.
export function ManagerAvatar({ avatar }: { avatar: Avatar | null }) {
  if (avatar === null) return <span className="as-avatar as-avatar-plain" style={FRAME} aria-hidden />;
  return (
    <span className="as-avatar" style={FRAME} aria-hidden>
      <BlobAvatar shape={avatar.shape} color={MANAGER_HUE_COLORS[avatar.hue]} expression={avatar.expression} animation="idle" paused size={BOX} style={avatar.hue === "white" ? EDGED : PLACE} />
    </span>
  );
}
