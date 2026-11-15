// GET /api/v1/plugins/notes/http/media?id=att_…: an attachment's bytes, for the Spotlight's <img>
// and <video>. The id is a query parameter because bb matches a plugin route's path exactly.
import { attachmentIdSchema } from "../../contract.ts";
import type { Store } from "../store.ts";
import type { MediaFiles } from "./media-files.ts";
import { parseRange } from "./range.ts";

/** What the handler reads of the hono `Context` bb hands a route. */
type MediaRequest = { req: { query(name: string): string | undefined; header(name: string): string | undefined } };

export function mediaRoute(store: Pick<Store, "attachment">, media: Pick<MediaFiles, "size" | "stream">) {
  return async (c: MediaRequest): Promise<Response> => {
    // why the schema: only `att_<uuid>` reaches the disk, so `?id=../x` is a 404, not a path.
    const id = attachmentIdSchema.safeParse(c.req.query("id"));
    if (!id.success) return notFound();
    const attachment = store.attachment(id.data);
    const size = attachment === null ? null : await media.size(id.data);
    if (attachment === null || size === null) return notFound();

    const headers = {
      "content-type": attachment.mimeType,
      "accept-ranges": "bytes",
      // why: the browser must never sniff a type other than the one stored.
      "x-content-type-options": "nosniff",
      // why immutable: an id is never reused and its file never rewritten.
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
