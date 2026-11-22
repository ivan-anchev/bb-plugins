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
          <div className="rmi-memory-card-preview" inert aria-hidden>
            <Markdown content={preview} />
          </div>
        )}
      </div>
    </button>
  );
}

function scrollIntoRow(event: FocusEvent<HTMLButtonElement>): void {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function placeOf(file: MemoryFile): { name: string; folder: string | null } {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? { name: file, folder: null } : { name: file.slice(slash + 1), folder: file.slice(0, slash) };
}
