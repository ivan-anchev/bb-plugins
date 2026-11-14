// A note's attachments at the end of its card row: up to three 30px thumbs held like a hand of cards,
// the first upright in front, then "+N" for the rest. A video shows its first frame under a play badge.
// Look: prototypes/notes-card-fan.html, variant Symmetric.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useState, type CSSProperties } from "react";
import { attachmentKind, type Attachment } from "../../../contract.ts";
import { mediaUrl } from "../../media-url.ts";

/** Thumbs drawn; the rest are counted in the badge. */
const FANNED = 3;

export function AttachmentFan({ attachments }: { attachments: readonly Attachment[] }) {
  if (attachments.length === 0) return null;
  const fanned = attachments.slice(0, FANNED);
  const rest = attachments.length - fanned.length;
  // Back to front, so the first attachment paints on top.
  const backToFront = fanned.map((attachment, index) => ({ attachment, lean: lean(index, fanned.length) })).reverse();
  return (
    // why hidden: the row's text already names the note, and the thumbs only show what it holds.
    <span className="nt-fan" aria-hidden>
      {backToFront.map(({ attachment, lean }) => (
        <span key={attachment.id} className="nt-fan-thumb" style={leanStyle(lean)}>
          {attachmentKind(attachment.mimeType) === "video" ? <VideoThumb attachment={attachment} /> : <img src={mediaUrl(attachment.id)} loading="lazy" alt="" />}
        </span>
      ))}
      {rest > 0 && <span className="nt-fan-more">+{rest}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

/** A frame the browser can't decode (an HEVC or ProRes .mov in Chromium) leaves a plain tile under the badge. */
function VideoThumb({ attachment }: { attachment: Attachment }) {
  const [undecodable, setUndecodable] = useState(false);
  return (
    <>
      {!undecodable && <video src={mediaUrl(attachment.id)} preload="metadata" muted playsInline onError={() => setUndecodable(true)} />}
      <span className="nt-fan-play">
        <Icon name="Play" />
      </span>
    </>
  );
}

/** Left, upright, or right. */
type Lean = -1 | 0 | 1;

/**
 * Which way a thumb turns: the front one stands upright, the 2nd leans left and the 3rd right. With
 * only two, the back one leans right, as in the prototype.
 */
function lean(index: number, count: number): Lean {
  if (index === 0) return 0;
  return index === 2 || count === 2 ? 1 : -1;
}

function leanStyle(lean: Lean): CSSProperties & Record<"--nt-lean", number> {
  return { "--nt-lean": lean };
}
