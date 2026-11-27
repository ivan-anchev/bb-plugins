// GET /api/v1/plugins/regional-manager/http/attachment?manager=…&id=…: an attachment's bytes, for
// the issue tab's thumbnails, lightbox and downloads. The ids are query parameters because bb matches
// a plugin route's path exactly (as notes' media route). Default "local" auth: only the bb app's own
// origin reads it, and only within the manager the URL names.
import { attachmentIdSchema } from "../../model/attachment.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

/** What the handler reads of the hono `Context` bb hands a route. */
type RouteRequest = { req: { query(name: string): string | undefined } };

export function attachmentRoute(store: Pick<Store, "attachmentFile">) {
  return (c: RouteRequest): Response => {
    // why the schemas: only a uuid pair reaches the database, so anything else is a 404, never a query.
    const manager = coordinatorIdSchema.safeParse(c.req.query("manager"));
    const id = attachmentIdSchema.safeParse(c.req.query("id"));
    if (!manager.success || !id.success) return notFound();
    const file = store.attachmentFile(manager.data, id.data);
    if (file === null) return notFound();
    return new Response(file.bytes, {
      headers: {
        "content-type": file.type,
        "content-length": String(file.bytes.byteLength),
        // why: the browser must never sniff a type other than the one stored, and nothing served here may run.
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        // why immutable: an id is never reused and its bytes never rewritten.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  };
}

const notFound = () => new Response("Not found", { status: 404 });
