// An opened note's images and videos. A video plays and seeks in place; an image opens
// bb's lightbox, which steps through all of the note's media.
import { experimental_ImageLightbox as Lightbox } from "@get-bb/plugin-sdk/app";
import { Content, Root } from "@radix-ui/react-dialog";
import { useRef, useState, type ReactNode } from "react";
import { attachmentKind, type Attachment } from "../../../contract.ts";
import { mediaUrl } from "../../media-url.ts";

export function NoteMedia({ attachments }: { attachments: readonly Attachment[] }) {
  const [shown, setShown] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul className="nt-media" aria-label="Attachments">
        {attachments.map((attachment, index) => (
          <li key={attachment.id} className="nt-media-item" title={attachment.name}>
            {attachmentKind(attachment.mimeType) === "video" ? (
              <video src={mediaUrl(attachment.id)} controls preload="metadata" playsInline aria-label={attachment.name} />
            ) : (
              <button
                type="button"
                className="nt-media-open"
                aria-label={`Open ${attachment.name}`}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setShown(index);
                }}
              >
                <img src={mediaUrl(attachment.id)} alt={attachment.name} loading="lazy" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {shown !== null && (
        <PreviewLayer onClose={() => setShown(null)} returnFocus={() => opener.current!.focus()}>
          <MediaLightbox attachments={attachments} index={shown} onShow={setShown} onClose={() => setShown(null)} />
        </PreviewLayer>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The lightbox opens inside an empty nested dialog. Radix stacks layers: one above the popover takes
 * Esc and outside clicks first, so closing the lightbox leaves the popover open, and closing the
 * dialog gives focus back to the thumb that opened it.
 */
function PreviewLayer({ onClose, returnFocus, children }: { onClose(): void; returnFocus(): void; children: ReactNode }) {
  const [trapPaused, setTrapPaused] = useState(false);
  return (
    <Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Content
        hidden
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setTrapPaused(true);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        {trapPaused && children}
      </Content>
    </Root>
  );
}

function MediaLightbox({
  attachments,
  index,
  onShow,
  onClose,
}: {
  attachments: readonly Attachment[];
  index: number;
  onShow(index: number): void;
  onClose(): void;
}) {
  const attachment = attachments[index];
  return (
    <Lightbox
      isOpen
      title={attachment.name}
      imageAlt={attachment.name}
      imageSrc={mediaUrl(attachment.id)}
      mediaType={attachmentKind(attachment.mimeType)}
      hasMultipleImages={attachments.length > 1}
      navigationStatus={`${index + 1} of ${attachments.length}`}
      previousDisabled={index === 0}
      nextDisabled={index === attachments.length - 1}
      onPrevious={() => onShow(index - 1)}
      onNext={() => onShow(index + 1)}
      onClose={onClose}
    />
  );
}
