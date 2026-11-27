// openAttachment: a Markdown attachment opens rendered in bb's side panel, the way bb opens any file.
// bb's preview opens only a live file (a workspace's, a host's or a thread's storage), never a URL, so
// the file is first written where bb can open it: its manager's thread storage, under
// attachments/<id>/<name>. Written again on every open, the same bytes to the same path, so a file
// someone deleted there comes back, and two opens agree.
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import { opensInPanel } from "../../model/attachment.ts";
import type { Store } from "../store/store.ts";

/** The parts of bb opening uses: where a thread's storage is, and a write into it. */
type OpenAttachmentBb = {
  sdk: {
    threads: { storageLocation(args: { threadId: string }): Promise<{ hostId: string; storageRootPath: string }> };
    files: { write(args: { hostId: string; rootPath: string; path: string; content: string; contentEncoding: "base64"; createParents: true }): Promise<unknown> };
  };
};

export function attachmentHandlers(bb: OpenAttachmentBb, store: Pick<Store, "coordinator" | "attachmentFile">): PluginRpcHandlers<Pick<typeof coordinatorContract, "openAttachment">> {
  return {
    openAttachment: async ({ coordinatorId, id }) => {
      const coordinator = store.coordinator(coordinatorId);
      const file = coordinator === null ? null : store.attachmentFile(coordinatorId, id);
      if (coordinator === null || file === null) throw new Refusal({ code: "not_found", message: `There is no attachment ${id} of a started regional manager ${coordinatorId}.` });
      if (!opensInPanel(file)) throw new Refusal({ code: "invalid", message: `${file.name} downloads; only a Markdown attachment opens in the panel.` });
      // why the id in it: two attachments may share a name, and an id is never reused.
      const path = `attachments/${id}/${file.name}`;
      const { hostId, storageRootPath } = await bb.sdk.threads.storageLocation({ threadId: coordinator.threadId });
      await bb.sdk.files.write({ hostId, rootPath: storageRootPath, path: `${storageRootPath}/${path}`, content: Buffer.from(file.bytes).toString("base64"), contentEncoding: "base64", createParents: true });
      return { threadId: coordinator.threadId, path };
    },
  };
}
