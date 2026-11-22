import { createReadStream, type Stats } from "node:fs";
import { link, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Attachment } from "../../contract.ts";

const CLOCK_SLACK_MS = 1_000;

export type MediaFiles = ReturnType<typeof openMediaFiles>;

type AttachmentId = Attachment["id"];

/**
 * `databasePath`: `bb.storage.database().name`. bb has no API for a plugin's own files, so they sit
 * beside its database. A path that is not absolute would put them wherever the server happened to
 * start, so it is refused rather than guessed at.
 */
export function openMediaFiles(databasePath: string) {
  if (!isAbsolute(databasePath)) throw new Error(`Notes can't store media: its database path "${databasePath}" is not absolute`);
  const dir = join(dirname(databasePath), "media");
  const keptDir = join(dirname(databasePath), "kept");
  const pathOf = (id: AttachmentId) => join(dir, id);

  return {
    dir,

    path: pathOf,

    async write(id: AttachmentId, bytes: Uint8Array): Promise<void> {
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.tmp-${id}`);
      await writeFile(temp, bytes);
      await rename(temp, pathOf(id));
    },

    async size(id: AttachmentId): Promise<number | null> {
      return (await statIfThere(pathOf(id)))?.size ?? null;
    },

    stream(id: AttachmentId, start: number, end: number): ReadableStream<Uint8Array> {
      const chunks: AsyncIterator<Buffer> = createReadStream(pathOf(id), { start, end })[Symbol.asyncIterator]();
      return new ReadableStream({
        async pull(controller) {
          const chunk = await chunks.next();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        },
        async cancel() {
          await chunks.return?.();
        },
      });
    },

    async keep(id: AttachmentId): Promise<string> {
      await mkdir(keptDir, { recursive: true });
      const kept = join(keptDir, id);
      await link(pathOf(id), kept).catch((error: NodeJS.ErrnoException) => (error.code === "EEXIST" ? undefined : Promise.reject(error)));
      return kept;
    },

    async remove(ids: readonly AttachmentId[]): Promise<void> {
      await Promise.all(ids.map((id) => rm(pathOf(id), { force: true })));
    },

    async sweep(isKnown: (name: string) => boolean, before: number): Promise<string[]> {
      const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
      const removed: string[] = [];
      for (const name of names) {
        const stats = await statIfThere(join(dir, name));
        if (stats === null || stats.mtimeMs >= before - CLOCK_SLACK_MS || isKnown(name)) continue;
        await rm(join(dir, name), { force: true });
        removed.push(name);
      }
      return removed;
    },
  };
}

function statIfThere(path: string): Promise<Stats | null> {
  return stat(path).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)));
}
