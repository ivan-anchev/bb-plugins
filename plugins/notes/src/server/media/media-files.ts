// Attachment bytes on disk: `media/<attachment id>` beside the plugin's data.db, one file each,
// written once and never rewritten.
import { createReadStream, type Stats } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Attachment } from "../../contract.ts";

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
  const pathOf = (id: AttachmentId) => join(dir, id);

  return {
    dir,

    // why a temp name then rename: a reader never sees half a file, and a crash mid-write leaves a
    // `.tmp-` file no row names, which the next sweep removes.
    async write(id: AttachmentId, bytes: Uint8Array): Promise<void> {
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.tmp-${id}`);
      await writeFile(temp, bytes);
      await rename(temp, pathOf(id));
    },

    /** The file's size in bytes, or null when it is gone. */
    async size(id: AttachmentId): Promise<number | null> {
      return (await statIfThere(pathOf(id)))?.size ?? null;
    },

    /** Bytes `start` to `end`, both included, read as the response is sent. */
    stream(id: AttachmentId, start: number, end: number): ReadableStream<Uint8Array> {
      // why not Readable.toWeb: @types/node's web stream type is not the DOM one a Response takes.
      const chunks: AsyncIterator<Buffer> = createReadStream(pathOf(id), { start, end })[Symbol.asyncIterator]();
      return new ReadableStream({
        // why pull: the file is read only as fast as the browser takes it.
        async pull(controller) {
          const chunk = await chunks.next();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        },
        // A seek drops the request: closing the iterator closes the file.
        async cancel() {
          await chunks.return?.();
        },
      });
    },

    /** Deletes the files; a file already gone is fine. */
    async remove(ids: readonly AttachmentId[]): Promise<void> {
      await Promise.all(ids.map((id) => rm(pathOf(id), { force: true })));
    },

    /**
     * Deletes the files last written before `before` that `isKnown` does not claim, and returns their
     * names. A file written since is kept: its note may still be on its way into the database.
     */
    async sweep(isKnown: (name: string) => boolean, before: number): Promise<string[]> {
      const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
      const removed: string[] = [];
      for (const name of names) {
        // why a file may be gone: the previous load's sweep can still be running beside this one.
        const stats = await statIfThere(join(dir, name));
        // why isKnown is asked here, after the awaits: a note saved meanwhile has claimed its file.
        if (stats === null || stats.mtimeMs >= before || isKnown(name)) continue;
        await rm(join(dir, name), { force: true });
        removed.push(name);
      }
      return removed;
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** The file's stats, or null when it is gone. */
function statIfThere(path: string): Promise<Stats | null> {
  return stat(path).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)));
}
