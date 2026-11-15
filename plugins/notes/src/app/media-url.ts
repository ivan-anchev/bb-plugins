// Where the browser reads an attachment's bytes: the plugin's media route (server.ts), same origin.
import type { Attachment } from "../contract.ts";

export function mediaUrl(id: Attachment["id"]): string {
  return `/api/v1/plugins/notes/http/media?id=${id}`;
}
