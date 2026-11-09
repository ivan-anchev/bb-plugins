// The canonical shape of a line someone points at in a file's diff: a guide's finding, a note the
// app draws under a line. Pure zod, shared by the app and the server.
import { z } from "zod";
import { diffSideSchema } from "../diff/diff-schema.ts";

/** A line number on one side of a file's diff. As in a finding, "old" names only a removed line. */
export const lineRefSchema = z.object({ side: diffSideSchema, line: z.number().int().positive() });
export type LineRef = z.infer<typeof lineRefSchema>;
