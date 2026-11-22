import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useState, type CSSProperties } from "react";
import { attachmentKind, type Attachment } from "../../../contract.ts";
import { mediaUrl } from "../../media-url.ts";

const FANNED = 3;

export function AttachmentFan({ attachments }: { attachments: readonly Attachment[] }) {
  if (attachments.length === 0) return null;
  const fanned = attachments.slice(0, FANNED);
  const rest = attachments.length - fanned.length;
  const backToFront = fanned.map((attachment, index) => ({ attachment, lean: lean(index, fanned.length) })).reverse();
  return (
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

type Lean = -1 | 0 | 1;

function lean(index: number, count: number): Lean {
  if (index === 0) return 0;
  return index === 2 || count === 2 ? 1 : -1;
}

function leanStyle(lean: Lean): CSSProperties & Record<"--nt-lean", number> {
  return { "--nt-lean": lean };
}
