import { attachmentIdSchema } from "../../contract.ts";
import type { Store } from "../store.ts";
import type { MediaFiles } from "./media-files.ts";
import { parseRange } from "./range.ts";

type MediaRequest = { req: { query(name: string): string | undefined; header(name: string): string | undefined } };

export function mediaRoute(store: Pick<Store, "attachment">, media: Pick<MediaFiles, "size" | "stream">) {
  return async (c: MediaRequest): Promise<Response> => {
    const id = attachmentIdSchema.safeParse(c.req.query("id"));
    if (!id.success) return notFound();
    const attachment = store.attachment(id.data);
    const size = attachment === null ? null : await media.size(id.data);
    if (attachment === null || size === null) return notFound();

    const headers = {
      "content-type": attachment.mimeType,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
    };
    const range = parseRange(c.req.header("range"), size);
    switch (range.kind) {
      case "whole":
        return new Response(media.stream(id.data, 0, size - 1), { status: 200, headers: { ...headers, "content-length": String(size) } });
      case "part":
        return new Response(media.stream(id.data, range.start, range.end), {
          status: 206,
          headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${size}` },
        });
      case "unsatisfiable":
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      default:
        return range satisfies never;
    }
  };
}

const notFound = () => new Response("Not found", { status: 404 });
