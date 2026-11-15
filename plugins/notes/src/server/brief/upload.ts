// One note attachment → a file bb holds for the composer's project, ready to sit in the draft as a
// chip. bb refuses a prompt attachment over 35 MB, so a larger one reaches the agent as its path.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readFile } from "node:fs/promises";
import type { Attachment } from "../../contract.ts";
import type { MediaFiles } from "../media/media-files.ts";
import type { BriefMedia } from "./brief.ts";

type ProjectAttachments = Pick<BbPluginApi["sdk"]["projects"]["attachments"], "upload">;

/** bb's `PROMPT_ATTACHMENT_MAX_BYTES` (bb 0.49): a 40 MB file is refused with "over the 35MB attachment limit". */
const BB_ATTACHMENT_MAX_BYTES = 35 * 1024 * 1024;

export async function uploadForBrief(attachments: ProjectAttachments, media: MediaFiles, projectId: string, attachment: Attachment): Promise<BriefMedia> {
  const path = media.path(attachment.id);
  if (attachment.sizeBytes > BB_ATTACHMENT_MAX_BYTES) return { kind: "tooLarge", path, name: attachment.name };
  // why on the server: the bytes are already here, so the browser never fetches and re-sends them.
  const uploaded = await attachments.upload({ projectId, clientFile: await readFile(path), filename: attachment.name, mimeType: attachment.mimeType });
  return { kind: "attached", attachment: uploaded };
}
