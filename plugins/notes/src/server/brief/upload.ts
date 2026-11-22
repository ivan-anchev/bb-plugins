import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readFile } from "node:fs/promises";
import type { Attachment } from "../../contract.ts";
import type { MediaFiles } from "../media/media-files.ts";
import type { BriefMedia } from "./brief.ts";

type ProjectAttachments = Pick<BbPluginApi["sdk"]["projects"]["attachments"], "upload">;

const BB_ATTACHMENT_MAX_BYTES = 35 * 1024 * 1024;

export async function uploadForBrief(attachments: ProjectAttachments, media: MediaFiles, projectId: string, attachment: Attachment): Promise<BriefMedia> {
  if (attachment.sizeBytes > BB_ATTACHMENT_MAX_BYTES) return { kind: "tooLarge", path: await media.keep(attachment.id), name: attachment.name };
  const uploaded = await attachments.upload({
    projectId,
    clientFile: await readFile(media.path(attachment.id)),
    filename: attachment.name,
    mimeType: attachment.mimeType,
  });
  return { kind: "attached", attachment: uploaded };
}
