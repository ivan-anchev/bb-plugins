// The images and videos attached to a draft, from the 📎 button, a paste, or a drop anywhere on the
// Spotlight. Each keeps an object URL for its thumb until it is removed or the Spotlight closes.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { MAX_FILE_BYTES, MAX_FILES, mediaMimeSchema, type MediaMime, type NewFile } from "../../../contract.ts";

/** A file the server will take: an allow-listed type, under the size cap. */
export type DraftFile = { file: File; mimeType: MediaMime; url: string };

export type DraftFiles = ReturnType<typeof useDraftFiles>;

export function useDraftFiles() {
  const [items, setItems] = useState<DraftFile[]>([]);
  /** Why the files last added were not all taken, or null when they were. */
  const [refused, setRefused] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const urls = useObjectUrls();

  const add = (files: ArrayLike<File>) => {
    const { taken, refusals } = sort(Array.from(files), items.length);
    const added = taken.map((item) => ({ ...item, url: urls.create(item.file) }));
    setItems((current) => [...current, ...added]);
    setRefused(refusals.length === 0 ? null : refusals.join(" · "));
  };

  return {
    items,
    refused,
    /** A file is being dragged over the Spotlight. */
    dragging,
    add,
    remove(item: DraftFile) {
      urls.revoke(item.url);
      setItems((current) => current.filter((candidate) => candidate !== item));
    },
    // why only file items: pasting text into the note must keep working as usual.
    onPaste(event: ClipboardEvent) {
      if (event.clipboardData.files.length === 0) return;
      event.preventDefault();
      add(event.clipboardData.files);
    },
    onDragOver(event: DragEvent) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave(event: DragEvent) {
      // why: moving between the Spotlight's own children fires dragleave too.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDragging(false);
    },
    onDrop(event: DragEvent) {
      setDragging(false);
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      add(event.dataTransfer.files);
    },
    /** Every file's bytes, ready for `createNote`. */
    encode(): Promise<NewFile[]> {
      return Promise.all(items.map(async ({ file, mimeType }) => ({ name: file.name, mimeType, base64: await readBase64(file) })));
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** Splits added files into those a draft holding `held` files takes, and one line per file it refuses. */
function sort(files: File[], held: number): { taken: Omit<DraftFile, "url">[]; refusals: string[] } {
  const taken: Omit<DraftFile, "url">[] = [];
  const refusals: string[] = [];
  for (const file of files) {
    const mimeType = mediaMimeSchema.safeParse(file.type);
    if (!mimeType.success) refusals.push(unsupported(file));
    else if (file.size > MAX_FILE_BYTES) refusals.push(`${file.name} is over 100 MB`);
    else if (held + taken.length >= MAX_FILES) refusals.push(`A note holds ${MAX_FILES} files at most`);
    else taken.push({ file, mimeType: mimeType.data });
  }
  return { taken, refusals: [...new Set(refusals)] };
}

/** "HEIC isn’t supported — convert to PNG or JPEG", naming the format by the file's extension. */
function unsupported(file: File): string {
  const format = (/\.([^.]+)$/.exec(file.name)?.[1] ?? file.type).toUpperCase();
  if (file.type.startsWith("image/")) return `${format} isn’t supported — convert to PNG or JPEG`;
  if (file.type.startsWith("video/")) return `${format} isn’t supported — convert to MP4`;
  return `${file.name} isn’t an image or a video`;
}

/** The file's bytes in base64, without the `data:…;base64,` prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn’t read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** The draft's object URLs: each is freed when its file is removed, and the rest when the Spotlight closes. */
function useObjectUrls() {
  const held = useRef(new Set<string>()).current;
  // why an effect: closing the Spotlight unmounts the draft, and nothing else frees what it holds.
  useEffect(() => () => held.forEach((url) => URL.revokeObjectURL(url)), [held]);
  return {
    create(file: File): string {
      const url = URL.createObjectURL(file);
      held.add(url);
      return url;
    },
    revoke(url: string) {
      URL.revokeObjectURL(url);
      held.delete(url);
    },
  };
}
