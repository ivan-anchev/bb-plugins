// The draft's attachments, one 40px thumb each under the text: a video shows its first frame with a
// play badge. A thumb's × removes it.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { attachmentKind } from "../../contract.ts";
import type { DraftFile } from "./draft-files.ts";

export function Thumbs({ items, onRemove }: { items: readonly DraftFile[]; onRemove(item: DraftFile): void }) {
  if (items.length === 0) return null;
  return (
    <ul className="nt-thumbs" aria-label="Attachments">
      {items.map((item) => (
        <li key={item.url} className="nt-thumb" title={item.file.name}>
          {attachmentKind(item.mimeType) === "video" ? (
            <>
              <video src={item.url} muted playsInline preload="metadata" aria-label={item.file.name} />
              <span className="nt-thumb-play" aria-hidden>
                <Icon name="Play" />
              </span>
            </>
          ) : (
            <img src={item.url} alt={item.file.name} />
          )}
          <button type="button" className="nt-thumb-remove" aria-label={`Remove ${item.file.name}`} onClick={() => onRemove(item)}>
            <Icon name="X" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
