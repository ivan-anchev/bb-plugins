// A memory file on the board's Memory, as a file in Capy's Drive: a card previewing its start,
// rendered, small and fading out where the card clips it, with the file's name under it and, for a
// file in a subfolder, its folder. A file deleted under a draft says so in place of its preview.
import "./memory-card.css";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { FocusEvent, Ref } from "react";
import type { MemoryFile } from "../../../model/memory-file.ts";

type MemoryCardProps = {
  ref: Ref<HTMLButtonElement>;
  file: MemoryFile;
  /** The start of the file's text; null: it is no longer in the folder, its draft kept. */
  preview: string | null;
  drafted: boolean;
  onOpen(): void;
};

export function MemoryCard({ ref, file, preview, drafted, onOpen }: MemoryCardProps) {
  const { name, folder } = placeOf(file);
  // why the name first: it names the button, and the preview, drawn above it, stays out of that.
  return (
    <button ref={ref} type="button" className="rmi-memory-card" onFocus={scrollIntoRow} onClick={onOpen}>
      <span className="rmi-memory-card-name">
        <span className="rmi-memory-card-file">{name}</span>
        {drafted && (
          <span className="rmi-memory-card-draft">
            <span className="sr-only">, unsaved changes</span>
          </span>
        )}
      </span>
      {folder !== null && (
        <span className="rmi-memory-card-folder">
          <span className="sr-only"> in </span>
          {folder}
        </span>
      )}
      <div className="rmi-memory-card-page">
        {preview === null ? (
          <span className="rmi-memory-card-missing">Not in the folder</span>
        ) : (
          // why inert and hidden: the preview is a picture of the file; its links and text are the open file's, and the name speaks for the card.
          <div className="rmi-memory-card-preview" inert aria-hidden>
            <Markdown content={preview} />
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Brings a card that takes focus wholly into its row, and into the board's view. why not leave it to
 * the browser: measured in Chrome, Tab left a card the row's edge cut in half where it was, and in
 * the narrow panel scrolled the row not at all, so the focused card stayed out of sight.
 */
function scrollIntoRow(event: FocusEvent<HTMLButtonElement>): void {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** A file's name, and the folder it is in under the memory folder (null: the memory folder itself). */
function placeOf(file: MemoryFile): { name: string; folder: string | null } {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? { name: file, folder: null } : { name: file.slice(slash + 1), folder: file.slice(0, slash) };
}
