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

// why: a white body on a light surface shows no edge; a hairline in the colour of the theme's input
// borders (--input, which reads on white where --border fades), hugging its outline, gives it one, as
// the Regional Manager plugin draws it. Each 0.5px shadow is one side; a blurred one would fade to nothing.
const EDGE = ["0.5px 0", "-0.5px 0", "0 0.5px", "0 -0.5px"].map((offset) => `drop-shadow(${offset} 0 var(--input))`).join(" ");

/**
 * why paused: a still picture, as the Regional Manager plugin shows it. why aria-hidden: the name beside
 * it says who this is. `size`: the frame's side; a row's unless given (a card's is smaller).
 */
export function ManagerAvatar({ avatar, size = SIZE }: { avatar: Avatar | null; size?: number }) {
  const frame: CSSProperties = { width: size, height: size };
  if (avatar === null) return <span className="as-avatar as-avatar-plain" style={frame} aria-hidden />;
  const box = (size * 200) / (2 * REACH);
  const place: CSSProperties = { position: "absolute", left: (size - box) / 2, top: (size - box) / 2, filter: avatar.hue === "white" ? EDGE : undefined };
  return (
    <span className="as-avatar" style={frame} aria-hidden>
      <BlobAvatar shape={avatar.shape} color={MANAGER_HUE_COLORS[avatar.hue]} expression={avatar.expression} animation="idle" paused size={box} style={place} />
    </span>
  );
}
