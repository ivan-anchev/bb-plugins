// A regional manager's avatar: a SIZE-square frame holding its still blob in its hue, drawn as the
// Regional Manager plugin draws it, or, while its look is unknown, a plain disc filling the frame.
import { BlobAvatar } from "blob-avatar";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Avatar } from "../../model/manager-look.ts";
import { HUE_COLORS } from "../../model/project-hue.ts";

// why: the size the name's line and the reply's line span exactly, with the gap between them (app.css .as-manager-words).
const SIZE = 36;

const FRAME: CSSProperties = { width: SIZE, height: SIZE };

// why aria-hidden: the name beside it says who this is.
export function ManagerAvatar({ avatar }: { avatar: Avatar | null }) {
  if (avatar === null) return <span className="as-avatar as-avatar-plain" style={FRAME} aria-hidden />;
  return (
    <span className="as-avatar" style={FRAME} aria-hidden>
      <FittedBlob avatar={avatar} />
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

/** blob-avatar draws in a 200-unit box, centred on 0. */
const VIEW = 200;

/** A shape's painted extent in that box, as `getBBox` measures it: ears and points included. */
type Painted = { x: number; y: number; width: number; height: number };

/** Until measured: blob-avatar's body spans about 136 of its 200 units, centred. */
const BODY: Painted = { x: -68, y: -68, width: 136, height: 136 };

/**
 * The blob, scaled and placed so what it paints spans the frame top to bottom and sits centred across
 * it, whatever its shape: a bunny's ears or a capsule's ends meet the frame as a circle's edge does.
 * why paused: a still picture, as the Regional Manager plugin shows it.
 */
function FittedBlob({ avatar }: { avatar: Avatar }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [painted, setPainted] = useState(BODY);

  // why a layout effect: the shape's extent is known only once drawn; measured before paint, the first frame is already fitted.
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const { x, y, width, height } = svg.getBBox();
    setPainted({ x, y, width, height });
  }, [avatar.shape, avatar.expression]);

  const scale = SIZE / painted.height;
  const place: CSSProperties = {
    position: "absolute",
    left: SIZE / 2 - (painted.x + painted.width / 2 + VIEW / 2) * scale,
    top: -(painted.y + VIEW / 2) * scale,
  };
  return (
    <span ref={ref}>
      <BlobAvatar
        shape={avatar.shape}
        color={HUE_COLORS[avatar.hue].fill}
        expression={avatar.expression}
        animation="idle"
        paused
        size={VIEW * scale}
        style={place}
      />
    </span>
  );
}
