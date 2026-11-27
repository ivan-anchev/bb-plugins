// A handoff's attachments in its open round (round-body.tsx), as one quiet strip under its headline:
// images first as small cropped thumbnails, then every other file as a chip with only its name. What
// each shows, and a file's size, are on its card on hover and focus (the round's one card intent),
// and in its accessible name, so touch and screen-reader users have them without hover. A thumbnail
// opens bb's own lightbox, which pages through the strip's images; a Markdown chip opens its file
// rendered in bb's side panel, as bb opens any file; any other chip downloads its file. Read with the
// round's body, so a folded round loads none of them.
import {
  experimental_ImageLightbox as ImageLightbox,
  experimental_PluginRpcCallError as RpcCallError,
  experimental_saveFile as saveFile,
  experimental_useRpcMutation,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { coordinatorContract as contract } from "../../../../../contract.ts";
import { attachmentUrl, isImage, opensInPanel, sizeText, type Attachment, type AttachmentId } from "../../../../../model/attachment.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { useEscapeToClose } from "../../../../ui/hold-escape.ts";
import type { CardPresence } from "../../../issue/hover-card/card-intent.ts";
import { capStyle } from "../../../issue/hover-card/hover-card.tsx";
import { useFollowingRowPlacement } from "../../../issue/hover-card/placement.ts";
import type { HoverCards } from "../../../issue/hover-card/use-hover-card.ts";

type Props = {
  coordinatorId: CoordinatorId;
  attachments: readonly Attachment[];
  /** Whose they are, for a screen reader: the strip has no visible label. */
  label: string;
  /** The open round's one card intent, so one card shows at a time across the round. */
  cards: HoverCards;
};

export function Attachments({ coordinatorId, attachments, label, cards }: Props) {
  const images = attachments.filter(isImage);
  const files = attachments.filter((attachment) => !isImage(attachment));
  const lightbox = useLightbox(images);
  const panel = usePanelOpener(coordinatorId);
  const items = useRef(new Map<AttachmentId, HTMLLIElement>());
  if (attachments.length === 0) return null;
  const url = (attachment: Attachment) => attachmentUrl(coordinatorId, attachment.id);
  const carded = attachments.find((attachment) => cards.shown === cardKey(attachment)) ?? null;
  const item = (attachment: Attachment) => ({
    ...cards.trigger(cardKey(attachment)),
    ref: (element: HTMLLIElement | null) => void (element === null ? items.current.delete(attachment.id) : items.current.set(attachment.id, element)),
  });
  return (
    <div className="rmi-attachments">
      <ul className="rmi-strip" aria-label={label}>
        {images.map((attachment, i) => (
          <li key={attachment.id} {...item(attachment)}>
            <Thumb attachment={attachment} src={url(attachment)} onOpen={() => lightbox.open(i)} thumbRef={lightbox.thumbRef(attachment.id)} />
          </li>
        ))}
        {files.map((attachment) => (
          <li key={attachment.id} {...item(attachment)}>
            <Chip attachment={attachment} href={url(attachment)} onPress={() => (opensInPanel(attachment) ? void panel.open(attachment) : void saveFile({ fileName: attachment.name, url: url(attachment) }))} />
          </li>
        ))}
      </ul>
      {panel.failure !== null && (
        <p role="alert" className="rmi-round-note">
          {panel.failure}
        </p>
      )}
      {carded !== null && <AttachmentCard key={carded.id} attachment={carded} presence={cards.presence(cardKey(carded))} anchor={() => items.current.get(carded.id)} />}
      <ImageLightbox
        isOpen={lightbox.shown !== null}
        imageSrc={lightbox.shown === null ? null : url(lightbox.shown)}
        imageAlt={lightbox.shown?.about ?? ""}
        title={lightbox.shown?.about ?? ""}
        hasMultipleImages={images.length > 1}
        navigationStatus={lightbox.at === null || images.length === 1 ? undefined : `${lightbox.at + 1} of ${images.length}`}
        previousDisabled={lightbox.at === 0}
        nextDisabled={lightbox.at === images.length - 1}
        onPrevious={lightbox.previous}
        onNext={lightbox.next}
        onClose={lightbox.close}
      />
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

const cardKey = (attachment: Attachment): string => `attachment-${attachment.id}`;

/** An image, small and cropped to its top, the part of a capture that says what it is; pressing it opens it larger. */
function Thumb({ attachment, src, onOpen, thumbRef }: { attachment: Attachment; src: string; onOpen: () => void; thumbRef: (element: HTMLButtonElement | null) => void }) {
  return (
    <button ref={thumbRef} type="button" className="rmi-thumb" aria-label={`${attachment.name}: ${attachment.about}`} onClick={onOpen}>
      {/* why no alt: the button's name says what it shows. */}
      <img src={src} alt="" width={48} height={32} loading="lazy" />
    </button>
  );
}

/**
 * Any other file, by its name alone; pressing it opens or downloads it (`onPress`). why a link with
 * the file's URL: it stays a link to copy, while bb's desktop shell, the browser and the iOS app each
 * take a download their own way (saveFile).
 */
function Chip({ attachment, href, onPress }: { attachment: Attachment; href: string; onPress: () => void }) {
  return (
    <a
      href={href}
      className="rmi-chip"
      aria-label={`${attachment.name}, ${sizeText(attachment.size)}: ${attachment.about}`}
      onClick={(event) => {
        event.preventDefault();
        onPress();
      }}
    >
      <span>{attachment.name}</span>
    </a>
  );
}

/**
 * Opens a Markdown attachment in bb's side panel: the server writes it into its manager's thread
 * storage first (open-attachment.ts), since bb's preview opens only a live file, never a URL. Why the
 * last open failed, until the next.
 */
function usePanelOpener(coordinatorId: CoordinatorId) {
  const write = experimental_useRpcMutation({ contract, method: "openAttachment" });
  const navigate = useBbNavigate();
  const [failure, setFailure] = useState<string | null>(null);
  return {
    failure,
    async open(attachment: Attachment) {
      setFailure(null);
      try {
        const target = await write.mutate({ coordinatorId, id: attachment.id });
        if (!navigate.experimental_openFilePreview({ target: { kind: "thread-storage", ...target }, location: null })) setFailure(`bb couldn't open ${attachment.name} in its panel here.`);
      } catch (error) {
        setFailure(`Could not open ${attachment.name}: ${RpcCallError.from(error).message}`);
      }
    },
  };
}

/**
 * Which of the strip's images the lightbox shows (null: closed), paging through them in order, and
 * focus handed back to the thumbnail of the one it closed on. why state: which image is open is the
 * reader's own choice, not data a refresh changes.
 */
function useLightbox(images: readonly Attachment[]) {
  const [at, setAt] = useState<number | null>(null);
  const thumbs = useRef(new Map<AttachmentId, HTMLButtonElement>());
  const returning = useRef<AttachmentId | null>(null);
  // why after the commit that closes it: focus moved while bb's dialog still holds it would be taken back.
  useEffect(() => {
    if (at !== null || returning.current === null) return;
    thumbs.current.get(returning.current)?.focus();
    returning.current = null;
  }, [at]);
  return {
    at,
    shown: at === null ? null : (images[at] ?? null),
    open: setAt,
    previous: () => setAt((now) => (now === null ? null : Math.max(0, now - 1))),
    next: () => setAt((now) => (now === null ? null : Math.min(images.length - 1, now + 1))),
    close: () => {
      returning.current = at === null ? null : (images[at]?.id ?? null);
      setAt(null);
    },
    thumbRef: (id: AttachmentId) => (element: HTMLButtonElement | null) => void (element === null ? thumbs.current.delete(id) : thumbs.current.set(id, element)),
  };
}

/**
 * An attachment's card: what it shows, and a file's size. Under the strip, or above it where the
 * panel has no room below (placement.ts), lined up with its own thumbnail or chip as far as the strip
 * allows. Escape puts it away, wherever focus is. why hidden from a screen reader: the trigger's
 * accessible name already says all of it.
 */
function AttachmentCard({ attachment, presence, anchor }: { attachment: Attachment; presence: CardPresence; anchor: () => HTMLElement | undefined }) {
  useEffect(() => presence.mounted(), [presence]);
  useEscapeToClose(true, presence.close);
  const { ref, body, placement } = useFollowingRowPlacement(presence.close);
  // why by hand, before paint: where the trigger sits in the strip is known only once laid out.
  useLayoutEffect(() => {
    const card = ref.current;
    const trigger = anchor();
    if (card === null || trigger === undefined || card.parentElement === null) return;
    card.style.left = `${Math.max(0, Math.min(trigger.offsetLeft, card.parentElement.clientWidth - card.offsetWidth))}px`;
  });
  return (
    <div ref={ref} className="rmi-card rmi-attachment-card" data-side={placement.side} style={capStyle(placement)} aria-hidden>
      <div ref={body} className="rmi-card-body rmi-attachment-card-body">
        <p className="rmi-attachment-about">{attachment.about}</p>
        {!isImage(attachment) && <p className="rmi-attachment-size">{sizeText(attachment.size)}</p>}
      </div>
    </div>
  );
}
