// A regional manager's avatar: a SIZE-square frame holding its still blob in its hue, drawn as the
// Regional Manager plugin draws it, or, while its look is unknown, a plain disc filling the frame.
// The row's text aligns to the frame, whatever the shape paints inside it.
import { BlobAvatar } from "blob-avatar";
import type { CSSProperties } from "react";
import type { Avatar } from "../../model/manager-look.ts";
import { HUE_COLORS } from "../../model/project-hue.ts";

// why: the size the name's line and the reply's line span exactly, with the gap between them (app.css .as-manager-words).
const SIZE = 36;

// why: blob-avatar 2.2.0 draws in a 200-unit box centred on 0, and none of its 21 shapes, in any of its
// 6 expressions, paints farther than 66.1 units from that centre (the cat's ears; the capsule reaches
// 64.4 across). Measured with getBBox, still; check again when blob-avatar changes. Scaling 2 × REACH
// units to the frame keeps every shape inside it, centred.
const REACH = 67;

/**
 * why paused: a still picture, as the Regional Manager plugin shows it. why aria-hidden: the name beside
 * it says who this is. `size`: the frame's side; a row's unless given (a card's is smaller).
 */
export function ManagerAvatar({ avatar, size = SIZE }: { avatar: Avatar | null; size?: number }) {
  const frame: CSSProperties = { width: size, height: size };
  if (avatar === null) return <span className="as-avatar as-avatar-plain" style={frame} aria-hidden />;
  const box = (size * 200) / (2 * REACH);
  const place: CSSProperties = { position: "absolute", left: (size - box) / 2, top: (size - box) / 2 };
  return (
    <span className="as-avatar" style={frame} aria-hidden>
      <BlobAvatar shape={avatar.shape} color={HUE_COLORS[avatar.hue].fill} expression={avatar.expression} animation="idle" paused size={box} style={place} />
    </span>
  );
}
