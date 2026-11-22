import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { MAX_FILE_BYTES, MAX_FILES, mediaMimeSchema, type MediaMime, type NewFile } from "../../contract.ts";

/** A file the server will take: an allow-listed type, under the size cap. */
export type DraftFile = { file: File; mimeType: MediaMime; url: string };

export type DraftFiles = ReturnType<typeof useDraftFiles>;

export function useDraftFiles() {
  const [items, setItems] = useState<DraftFile[]>([]);
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
    dragging,
    add,
    remove(item: DraftFile) {
      urls.revoke(item.url);
      setItems((current) => current.filter((candidate) => candidate !== item));
    },
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
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDragging(false);
    },
    onDrop(event: DragEvent) {
      setDragging(false);
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      add(event.dataTransfer.files);
    },
    encode(): Promise<NewFile[]> {
      return Promise.all(items.map(async ({ file, mimeType }) => ({ name: file.name, mimeType, base64: await readBase64(file) })));
    },
  };
}

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

function unsupported(file: File): string {
  const format = (/\.([^.]+)$/.exec(file.name)?.[1] ?? file.type).toUpperCase();
  if (file.type.startsWith("image/")) return `${format} isn’t supported — convert to PNG or JPEG`;
  if (file.type.startsWith("video/")) return `${format} isn’t supported — convert to MP4`;
  return `${file.name} isn’t an image or a video`;
}

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

function useObjectUrls() {
  const held = useRef(new Set<string>()).current;
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
